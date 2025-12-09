import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { SubtitleSegment, SubtitleViewMode, SubtitleStyle } from '../types';
import { SubtitleOverlay } from './SubtitleOverlay';

const PREVIEW_SUBTITLE: SubtitleSegment = {
    startTime: 0,
    endTime: 0,
    english: "This is a sample subtitle style preview text.",
    chinese: "这是一个用于预览样式的中文示例字幕文本。"
};

interface PlayerProps {
  videoUrl: string | null;
  subtitles: SubtitleSegment[];
  viewMode: SubtitleViewMode;
  subStyle: SubtitleStyle;
  isExporting: boolean;
  isPreviewMode?: boolean;
  onTriggerFileSelect: () => void;
  // New prop to sync time with App
  onTimeUpdate?: (time: number) => void;
}

// Memoizing the Player component is CRITICAL to prevent re-renders of the video element 
// when the parent App component updates (e.g. from the throttled time update).
export const Player = React.memo(forwardRef<HTMLVideoElement, PlayerProps>(({ 
  videoUrl, 
  subtitles, 
  viewMode, 
  subStyle, 
  isExporting, 
  isPreviewMode = false,
  onTriggerFileSelect,
  onTimeUpdate
}, ref) => {
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isHovering, setIsHovering] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Optimization: Store active subtitle in state to prevent Overlay from re-rendering on every time update
  const [activeSubtitle, setActiveSubtitle] = useState<SubtitleSegment | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  
  // Optimization: Track last index to avoid O(N) search every frame
  const activeSubIndexRef = useRef<number>(-1);
  const activeSubRef = useRef<SubtitleSegment | null>(null);
  
  // Store the last non-zero volume to restore after unmuting
  const lastVolumeRef = useRef<number>(1);

  // Refs for direct DOM manipulation (Performance optimization)
  const progressBarRef = useRef<HTMLInputElement>(null);
  const timeDisplayRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Throttle control for UI updates (Progress bar doesn't need 60fps)
  const lastUiUpdateRef = useRef<number>(0);

  useImperativeHandle(ref, () => localVideoRef.current as HTMLVideoElement);

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const updateUI = useCallback(() => {
    const video = localVideoRef.current;
    if (!video) return;

    const time = video.currentTime;
    const now = performance.now();

    // --- High Frequency Logic (Subtitle Sync) ---
    // Must run every frame for precision
    
    let foundSub: SubtitleSegment | null = null;
    let foundIndex = -1;

    // Safety check: if subtitles empty or index invalid, reset or skip
    if (subtitles.length > 0) {
        // Fix potential crash: if index exceeds new length (e.g. after re-generation), reset it
        if (activeSubIndexRef.current >= subtitles.length) {
            activeSubIndexRef.current = -1;
        }

        // Check if current cached subtitle is still valid
        const currentCached = activeSubRef.current;
        if (currentCached && time >= currentCached.startTime && time <= currentCached.endTime) {
            foundSub = currentCached;
            foundIndex = activeSubIndexRef.current;
        } else {
            // Optimization: Start search from the last known index
            const startIndex = Math.max(0, activeSubIndexRef.current);
            
            // Check forward first
            for (let i = startIndex; i < subtitles.length; i++) {
                if (time >= subtitles[i].startTime && time <= subtitles[i].endTime) {
                    foundSub = subtitles[i];
                    foundIndex = i;
                    break;
                }
                // Optimization: If we passed the time, stop searching (assuming sorted subtitles)
                if (subtitles[i].startTime > time) break;
            }

            // If not found forward, and we started > 0, check from beginning (user seeked back)
            if (!foundSub && startIndex > 0) {
                 // Loop only up to current start index to prevent redundancy
                 const scanEnd = Math.min(startIndex, subtitles.length);
                 for (let i = 0; i < scanEnd; i++) {
                    if (time >= subtitles[i].startTime && time <= subtitles[i].endTime) {
                        foundSub = subtitles[i];
                        foundIndex = i;
                        break;
                    }
                }
            }
        }
    }

    if (foundSub !== activeSubRef.current) {
        activeSubRef.current = foundSub;
        activeSubIndexRef.current = foundIndex;
        setActiveSubtitle(foundSub);
    }

    // --- Low Frequency Logic (UI Updates) ---
    // Update progress bar/text/list every 100ms (10fps) - was 250ms
    // 100ms is responsive enough for lists without overloading the main thread
    if (now - lastUiUpdateRef.current > 100) {
        lastUiUpdateRef.current = now;

        // Update Progress Bar directly
        if (progressBarRef.current) {
            progressBarRef.current.value = time.toString();
            const percent = (time / (video.duration || 1)) * 100;
            progressBarRef.current.style.backgroundSize = `${percent}% 100%`;
        }

        // Update Time Text directly
        if (timeDisplayRef.current) {
            timeDisplayRef.current.textContent = `${formatTime(time)} / ${formatTime(video.duration || 0)}`;
        }
        
        // Sync back to Parent App (for SubtitleList)
        // We do this inside the throttled block so the heavy SubtitleList doesn't re-render 60 times a second
        if (onTimeUpdate) {
            onTimeUpdate(time);
        }
    }

    if (!video.paused && !video.ended) {
        animationFrameRef.current = requestAnimationFrame(updateUI);
    }
  }, [subtitles, onTimeUpdate]);

  useEffect(() => {
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
    }
    setIsPlaying(false);
    setActiveSubtitle(null);
    activeSubRef.current = null;
    activeSubIndexRef.current = -1;
    
    if(localVideoRef.current) {
        localVideoRef.current.currentTime = 0;
    }
    if (progressBarRef.current) {
        progressBarRef.current.value = "0";
        progressBarRef.current.style.backgroundSize = `0% 100%`;
    }
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = "0:00 / 0:00";
  }, [videoUrl]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Allowed keyboard control even during export
      if (e.code === 'Space' && videoUrl) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoUrl, isPlaying, isExporting]);

  useEffect(() => {
      if (isPlaying) {
          animationFrameRef.current = requestAnimationFrame(updateUI);
      } else {
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      }
      return () => {
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      }
  }, [isPlaying, updateUI]);


  const togglePlay = () => {
    if (localVideoRef.current) {
      if (localVideoRef.current.paused) {
        localVideoRef.current.play().catch((e) => {
            // Ignore AbortError which happens if you pause immediately after play
            if (e.name !== 'AbortError') {
                console.error(e);
            }
        });
      } else {
        localVideoRef.current.pause();
      }
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (localVideoRef.current) {
      localVideoRef.current.currentTime = time;
      // Reset index hint on seek to ensure correct search
      activeSubIndexRef.current = -1;
      // Force UI update immediately on seek
      lastUiUpdateRef.current = 0; 
      updateUI();
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (localVideoRef.current) {
      localVideoRef.current.volume = vol;
    }
  };

  const toggleMute = () => {
    if (!localVideoRef.current) return;
    
    if (volume > 0) {
      // Mute
      lastVolumeRef.current = volume;
      setVolume(0);
      localVideoRef.current.volume = 0;
    } else {
      // Unmute (restore last volume or default to 1)
      const restoreVol = lastVolumeRef.current > 0 ? lastVolumeRef.current : 1;
      setVolume(restoreVol);
      localVideoRef.current.volume = restoreVol;
    }
  };

  // REMOVED !isExporting check to keep controls visible during background export
  const showControls = videoUrl && (!isPlaying || isHovering);

  return (
    <div 
        ref={containerRef}
        className="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 group select-none"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
    >
        {videoUrl ? (
            <>
                <video
                    ref={localVideoRef}
                    src={videoUrl}
                    className="w-full h-full object-contain"
                    onClick={togglePlay}
                    onLoadedMetadata={() => {
                        if (localVideoRef.current) {
                            setDuration(localVideoRef.current.duration);
                            if(timeDisplayRef.current) timeDisplayRef.current.textContent = `0:00 / ${formatTime(localVideoRef.current.duration)}`;
                        }
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    crossOrigin="anonymous"
                />
                
                <SubtitleOverlay 
                    activeSubtitle={isPreviewMode ? PREVIEW_SUBTITLE : activeSubtitle}
                    viewMode={viewMode} 
                    style={subStyle}
                />

                {!isPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 cursor-pointer" onClick={togglePlay}>
                    <div className="w-16 h-16 bg-black/50 rounded-full flex items-center justify-center border border-white/10 hover:scale-110 transition-transform shadow-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white ml-1" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                )}

                <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pt-12 pb-4 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                  
                  <div className="flex items-center gap-2 mb-2 group/progress">
                     <input
                      ref={progressBarRef}
                      type="range"
                      min="0"
                      max={duration || 0}
                      step="0.01"
                      defaultValue="0"
                      onChange={handleSeek}
                      style={{ 
                          backgroundImage: 'linear-gradient(#3b82f6, #3b82f6)', 
                          backgroundSize: '0% 100%', 
                          backgroundRepeat: 'no-repeat' 
                      }}
                      className="w-full h-1.5 bg-white/30 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-125 transition-all"
                    />
                  </div>

                  <div className="flex items-center justify-between text-white">
                    <div className="flex items-center gap-4">
                      <button onClick={togglePlay} className="hover:text-blue-400 transition-colors">
                        {isPlaying ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>

                      <div ref={timeDisplayRef} className="text-xs font-mono text-slate-300 min-w-[80px]">
                        0:00 / 0:00
                      </div>

                      <div className="flex items-center gap-2 group/volume">
                        <button onClick={toggleMute} className="focus:outline-none hover:text-white text-slate-300 transition-colors">
                          {volume === 0 ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                               <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0117 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                        <input 
                          type="range" 
                          min="0" max="1" step="0.1"
                          value={volume}
                          onChange={handleVolumeChange}
                          className="w-20 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className="text-xs text-slate-400 font-medium px-2 py-1 bg-white/10 rounded">
                        {viewMode === 'dual' ? '双语' : viewMode === 'cn' ? '中文' : viewMode === 'en' ? '英文' : '关闭'}
                      </span>
                      <button onClick={toggleFullscreen} className="hover:text-blue-400 transition-colors">
                        {isFullscreen ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                             <path fillRule="evenodd" d="M5 8a1 1 0 011-1h1V6a1 1 0 012 0v3.5a1 1 0 01-1 1H4.5a1 1 0 01-1-1V8zm10 0a1 1 0 00-1-1h-1V6a1 1 0 00-2 0v3.5a1 1 0 001 1h3.5a1 1 0 001-1V8zm-10 4a1 1 0 001 1h1v2a1 1 0 002 0v-3.5a1 1 0 00-1-1H4.5a1 1 0 00-1 1v3.5zm10 0a1 1 0 01-1 1h-1v2a1 1 0 01-2 0v-3.5a1 1 0 011-1h3.5a1 1 0 011 1v3.5z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 110-2h4a1 1 0 011 1v4a1 1 0 11-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 9a1 1 0 110 2h4a1 1 0 110-2H5v-1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 110 2H4z" clipRule="evenodd" />
                            <path d="M15 11a1 1 0 112 0v4a1 1 0 01-1 1h-4a1 1 0 110-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 12.586V11z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
            </>
        ) : (
            <div 
                onClick={onTriggerFileSelect}
                className="w-full h-full flex flex-col items-center justify-center cursor-pointer bg-gradient-to-b from-slate-900 to-black hover:from-slate-800 transition-colors"
            >
                <div className="w-24 h-24 bg-slate-800/50 rounded-full flex items-center justify-center mb-6 border border-slate-700 shadow-xl group-hover:scale-110 group-hover:border-blue-500/50 group-hover:bg-slate-800 transition-all duration-300">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-400 group-hover:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="text-2xl font-bold text-white mb-2 tracking-tight">Click to Upload Video</p>
                <p className="text-sm text-slate-500">Support MP4 / WebM (Unlimited Size)</p>
              </div>
        )}
    </div>
  );
}));

Player.displayName = 'Player';