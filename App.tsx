import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ProcessingStatus, SubtitleSegment, VideoData, SubtitleViewMode, SubtitleStyle, TranslationMode } from './types';
import { generateSubtitles } from './services/geminiService';
import { Player } from './components/Player';
import { SubtitleList } from './components/SubtitleList';

type ExportFormat = 'mp4' | 'webm' | 'mov' | 'mkv' | 'avi';

const MODELS = [
  { id: 'gemini-3-pro-preview', label: 'gemini-3-pro (最新预览)', disabled: false },
  { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro (综合最强)', disabled: false },
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (速度极快)', disabled: false },
  { id: 'gemini-1.5-pro', label: 'gemini-1.5-pro (稳健保底)', disabled: false },
  { id: 'gemini-1.5-flash', label: 'gemini-1.5-flash (旧版备用)', disabled: false },
  { id: 'gemini-exp-1206', label: 'gemini-exp-1206 (实验尝鲜)', disabled: false },
];

const TRANS_MODES = [
  { id: 'en_to_cn', label: '英语 -> 中文' },
  { id: 'cn_to_en', label: '中文 -> 英语' },
];

const EXPORT_FORMATS = [
  { id: 'mp4', label: 'MP4' },
  { id: 'webm', label: 'WebM' },
  { id: 'mov', label: 'MOV' },
  { id: 'mkv', label: 'MKV' },
  { id: 'avi', label: 'AVI' },
];

export const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>('idle');
  const [videoData, setVideoData] = useState<VideoData>({ file: null, url: null, duration: 0 });
  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  
  // API Key State
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [tempApiKey, setTempApiKey] = useState<string>('');
  
  // App Exit State
  const [showExitModal, setShowExitModal] = useState<boolean>(false);
  
  // Model Selection
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
  const [showModelMenu, setShowModelMenu] = useState<boolean>(false);

  // Translation Mode Selection
  const [translationMode, setTranslationMode] = useState<TranslationMode>('en_to_cn');
  const [showTransMenu, setShowTransMenu] = useState<boolean>(false);

  // View State
  const [viewMode, setViewMode] = useState<SubtitleViewMode>('dual');
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  
  // Export State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('mp4');
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportTimeLeft, setExportTimeLeft] = useState<number | null>(null);
  const [exportResult, setExportResult] = useState<{success: boolean, msg?: string} | null>(null);
  
  // Upload State
  const [uploadStartTime, setUploadStartTime] = useState<number | null>(null);
  const [uploadElapsed, setUploadElapsed] = useState<number>(0);

  // Collapsible Panels State - Default to false (collapsed) for mobile
  const [isControlPanelOpen, setIsControlPanelOpen] = useState<boolean>(false);
  const [isSubtitleListOpen, setIsSubtitleListOpen] = useState<boolean>(false);

  // Export Cache
  const cachedExportRef = useRef<{
      key: string;
      blob: Blob;
      fileName: string;
  } | null>(null);

  // Subtitle Style State
  const [subStyle, setSubStyle] = useState<SubtitleStyle>({
    enSize: 15,
    cnSize: 15, 
    enColor: '#ffffff',
    cnColor: '#facc15',
    verticalPosition: 10
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const offlineVideoRef = useRef<HTMLVideoElement | null>(null);
  const exportAudioCtxRef = useRef<AudioContext | null>(null);

  const formatDuration = (seconds: number | null) => {
    if (seconds === null) return '计算中...';
    const sec = Math.ceil(seconds);
    if (sec < 60) return `${sec}秒`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}分${s}秒`;
  };

  const cancelExport = () => {
    if (mediaRecorderRef.current) {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.onerror = null;
        if (mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    }
    if (offlineVideoRef.current) {
        offlineVideoRef.current.pause();
        offlineVideoRef.current.removeAttribute('src');
        offlineVideoRef.current.load();
        if (document.body.contains(offlineVideoRef.current)) {
            document.body.removeChild(offlineVideoRef.current);
        }
        offlineVideoRef.current = null;
    }
    if (exportAudioCtxRef.current) {
        exportAudioCtxRef.current.close();
        exportAudioCtxRef.current = null;
    }
    setIsExporting(false);
    setExportProgress(0);
    setExportTimeLeft(null);
  };

  // Listen for Electron Close Request
  useEffect(() => {
    if ((window as any).require) {
        try {
            const { ipcRenderer } = (window as any).require('electron');
            const handleCloseRequest = () => {
                setShowExitModal(true);
            };
            ipcRenderer.on('app-close-request', handleCloseRequest);
            return () => {
                ipcRenderer.removeListener('app-close-request', handleCloseRequest);
            };
        } catch (e) {
            console.debug("Electron IPC not available");
        }
    }
  }, []);

  const handleConfirmExit = () => {
      if ((window as any).require) {
          try {
              const { ipcRenderer } = (window as any).require('electron');
              ipcRenderer.send('app-close-confirm');
          } catch(e) {
              console.error("Failed to send exit confirmation", e);
          }
      }
      setShowExitModal(false);
  };

  // Check API Key on mount
  useEffect(() => {
    const checkKey = async () => {
      const storedKey = localStorage.getItem('GEMINI_API_KEY');
      let found = false;
      if (storedKey) {
          (window as any).process = (window as any).process || { env: {} };
          (window as any).process.env.API_KEY = storedKey;
          found = true;
      }
      
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (hasKey) found = true;
      }

      setHasApiKey(found);
    };
    checkKey();
  }, []);

  // Auto-dismiss export result notification after 3 seconds
  useEffect(() => {
    if (exportResult) {
      const timer = setTimeout(() => {
        setExportResult(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [exportResult]);

  const handleOpenApiKeySettings = async () => {
      setErrorMsg(null);
      if (window.aistudio) {
          try {
            await window.aistudio.openSelectKey();
            const hasKey = await window.aistudio.hasSelectedApiKey();
            if (hasKey) setHasApiKey(true);
          } catch (e) {
            console.error("Error selecting key:", e);
          }
      } else {
          setTempApiKey(localStorage.getItem('GEMINI_API_KEY') || '');
          setShowApiKeyModal(true);
      }
  };

  const processSelectedFile = useCallback((file: File) => {
      setErrorMsg(null);
      const url = URL.createObjectURL(file);
      setVideoData({ file, url, duration: 0 });
      setStatus('idle');
      setSubtitles([]);
      setExportProgress(0);
      setExportTimeLeft(null);
      setExportResult(null);
      setIsPreviewMode(false);
      cachedExportRef.current = null;
  }, []);

  // Core Processing Logic extracted for re-use
  const executeGeneration = async () => {
    if (!videoData.file) return;

    setStatus('uploading');
    setUploadStartTime(Date.now());
    setUploadElapsed(0);
    setErrorMsg(null);

    try {
      // PASS THE SELECTED MODEL AND TRANSLATION MODE HERE
      const result = await generateSubtitles(videoData.file, selectedModel, translationMode, (newStatus) => {
        setStatus(newStatus);
        if (newStatus === 'analyzing') {
            setUploadStartTime(null);
        }
      });
      
      setSubtitles(result);
      setStatus('completed');
      if(videoRef.current) {
        videoRef.current.play().catch((e) => {
            if (e.name !== 'AbortError') console.error(e);
        });
      }
    } catch (err: any) {
      console.error("Processing failed:", err);
      setUploadStartTime(null);
      
      let message = "发生未知错误，请重试。";
      
      if (err instanceof Error) {
        message = err.message;
      } else if (err.error && err.error.message) {
        message = err.error.message;
      } else if (typeof err === 'string') {
        message = err;
      }
      
      const errStr = JSON.stringify(err);

      if (errStr.includes('401') || errStr.includes('UNAUTHENTICATED') || errStr.includes('invalid authentication credentials') || errStr.includes('API Key not found')) {
        message = "认证失败：API Key 无效或未设置。请点击右上角“配置 API Key”进行配置。";
        setHasApiKey(false); 
      } else if (
          errStr.includes('413') || 
          errStr.includes('Payload Too Large') || 
          errStr.includes('RPC') || 
          errStr.includes('xhr error') ||
          errStr.includes('code: 6') || 
          errStr.includes('500')
      ) {
          message = "请求失败：网络连接不稳定或文件过大导致代理超时。请尝试使用较小的视频文件或检查网络。";
      }

      setStatus('error');
      setErrorMsg(message);
    }
  };

  const handleSaveApiKey = () => {
      const trimmedKey = tempApiKey.trim();
      
      if (trimmedKey) {
          localStorage.setItem('GEMINI_API_KEY', trimmedKey);
          (window as any).process = (window as any).process || { env: {} };
          (window as any).process.env.API_KEY = trimmedKey;
          setHasApiKey(true);
      } else {
          localStorage.removeItem('GEMINI_API_KEY');
          (window as any).process = (window as any).process || { env: {} };
          (window as any).process.env.API_KEY = '';
          setHasApiKey(false);
      }
      
      setShowApiKeyModal(false);
      setErrorMsg(null);
  };

  const handleModalCancel = () => {
      setShowApiKeyModal(false);
  };

  // Upload timer
  useEffect(() => {
    let interval: number;
    if (status === 'uploading' && uploadStartTime) {
      interval = window.setInterval(() => {
        setUploadElapsed(Math.floor((Date.now() - uploadStartTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status, uploadStartTime]);

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  useEffect(() => {
    return () => {
      if (videoData.url) URL.revokeObjectURL(videoData.url);
      if (offlineVideoRef.current && document.body.contains(offlineVideoRef.current)) {
        document.body.removeChild(offlineVideoRef.current);
      }
      if (offlineVideoRef.current) {
        offlineVideoRef.current.pause();
        offlineVideoRef.current.src = "";
        offlineVideoRef.current.load();
        offlineVideoRef.current = null;
      }
      if (exportAudioCtxRef.current) {
        exportAudioCtxRef.current.close();
      }
    };
  }, [videoData.url]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      processSelectedFile(file);
    }
    e.target.value = '';
  }, [processSelectedFile]);

  const handleFileDrop = useCallback((file: File) => {
    processSelectedFile(file);
  }, [processSelectedFile]);

  const handleTriggerFileSelect = useCallback(() => {
      fileInputRef.current?.click();
  }, []);

  const handleSeek = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play().catch((e) => {
         if (e.name !== 'AbortError') console.error(e);
      });
      setCurrentTime(time);
    }
  }, []);

  const handleProcess = async () => {
    if (!videoData.file) return;

    const isElectron = navigator.userAgent.toLowerCase().includes(' electron/');
    let isConfigured = hasApiKey;
    
    if (!isConfigured) {
        if (window.aistudio) {
            isConfigured = await window.aistudio.hasSelectedApiKey();
            if (isConfigured) setHasApiKey(true);
        } else {
            if (localStorage.getItem('GEMINI_API_KEY')) {
                isConfigured = true;
                setHasApiKey(true);
            }
        }
    }

    if (!isConfigured) {
        if (isElectron) {
            if (window.aistudio) {
                try {
                    await window.aistudio.openSelectKey();
                    isConfigured = await window.aistudio.hasSelectedApiKey();
                    if (isConfigured) setHasApiKey(true);
                    else return; 
                } catch (e) {
                    console.error(e);
                    return;
                }
            } else {
                setShowApiKeyModal(true);
                return;
            }
        }
        // Web Bypass: Proceed without key to simulate (geminiService will use placeholder)
    }
    
    executeGeneration();
  };

  const downloadSRT = () => {
    if (subtitles.length === 0) return;
    let srtContent = '';
    const formatSrtTime = (s: number) => {
      const date = new Date(0);
      date.setMilliseconds(s * 1000);
      return date.toISOString().substr(11, 12).replace('.', ',');
    };
    subtitles.forEach((sub, index) => {
      srtContent += `${index + 1}\n`;
      srtContent += `${formatSrtTime(sub.startTime)} --> ${formatSrtTime(sub.endTime)}\n`;
      srtContent += `${sub.english}\n${sub.chinese}\n\n`;
    });
    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (videoData.file?.name.replace(/\.[^/.]+$/, "") || 'subtitles') + '.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportBurned = async () => {
    if (!videoData.url || isExporting) return;
    setExportResult(null);
    const currentExportKey = JSON.stringify({
        videoUrl: videoData.url,
        subtitles,
        viewMode,
        subStyle,
        exportFormat
    });
    if (cachedExportRef.current && cachedExportRef.current.key === currentExportKey) {
        const { blob, fileName } = cachedExportRef.current;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        return;
    }
    let mimeType = '';
    let preferredMimes: string[] = [];
    if (exportFormat === 'mp4' || exportFormat === 'mov') {
        preferredMimes = [
            'video/mp4;codecs=avc1.640034,mp4a.40.2',
            'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            'video/mp4',
            'video/webm;codecs=vp9,opus',
            'video/webm'
        ];
    } else {
        preferredMimes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4;codecs=avc1.640034,mp4a.40.2',
            'video/mp4'
        ];
    }
    mimeType = preferredMimes.find(type => MediaRecorder.isTypeSupported(type)) || '';
    if (!mimeType) {
        alert("您的浏览器不支持视频导出功能 (MediaRecorder API not supported).");
        return;
    }
    setIsExporting(true);
    setExportProgress(0);
    setExportTimeLeft(null);
    setIsPreviewMode(false);
    const startTime = Date.now();
    const offlineVideo = document.createElement('video');
    offlineVideo.src = videoData.url;
    offlineVideo.crossOrigin = "anonymous";
    offlineVideo.muted = false; 
    offlineVideo.playsInline = true;
    offlineVideo.style.cssText = "position:fixed; top:0; left:0; width:1px; height:1px; opacity:0; pointer-events:none; z-index:-9999;";
    document.body.appendChild(offlineVideo);
    offlineVideoRef.current = offlineVideo;
    await new Promise<void>((resolve) => {
        if (offlineVideo.readyState >= 1) resolve();
        else offlineVideo.onloadedmetadata = () => resolve();
    });
    const canvas = exportCanvasRef.current!;
    const MAX_WIDTH = 1920;
    const MAX_HEIGHT = 1080;
    let targetWidth = offlineVideo.videoWidth;
    let targetHeight = offlineVideo.videoHeight;
    if (targetWidth > MAX_WIDTH || targetHeight > MAX_HEIGHT) {
        const ratio = targetWidth / targetHeight;
        if (ratio > 1) {
            targetWidth = MAX_WIDTH;
            targetHeight = Math.round(MAX_WIDTH / ratio);
        } else {
            targetHeight = MAX_HEIGHT;
            targetWidth = Math.round(MAX_HEIGHT * ratio);
        }
    }
    if (targetWidth % 2 !== 0) targetWidth--;
    if (targetHeight % 2 !== 0) targetHeight--;
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const fontScale = canvas.width / 1280; 
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContext();
    exportAudioCtxRef.current = audioCtx;
    await audioCtx.resume();
    const source = audioCtx.createMediaElementSource(offlineVideo);
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);
    const canvasStream = canvas.captureStream(30);
    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) {
        canvasStream.addTrack(audioTrack);
    }
    const recorder = new MediaRecorder(canvasStream, { 
      mimeType, 
      videoBitsPerSecond: 15000000, 
      audioBitsPerSecond: 128000,
      // @ts-ignore
      videoKeyFrameIntervalDuration: 1000 
    });
    mediaRecorderRef.current = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };
    const cleanup = () => {
        if (offlineVideoRef.current) {
            offlineVideoRef.current.pause();
            offlineVideoRef.current.removeAttribute('src');
            offlineVideoRef.current.load();
            if (document.body.contains(offlineVideoRef.current)) {
                document.body.removeChild(offlineVideoRef.current);
            }
        }
        if (exportAudioCtxRef.current) {
            exportAudioCtxRef.current.close();
        }
        setIsExporting(false);
        setExportTimeLeft(null);
    };
    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType }); 
        const fileName = (videoData.file?.name.replace(/\.[^/.]+$/, "") || 'video') + `_subs.${exportFormat}`;
        cachedExportRef.current = {
            key: currentExportKey,
            blob,
            fileName
        };
        setExportResult({ success: true, msg: "导出成功！" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        cleanup();
    };
    recorder.onerror = (e) => {
        console.error("Recorder error:", e);
        setExportResult({ success: false, msg: "导出失败" });
        cleanup();
    }
    const drawText = (
        text: string, 
        x: number, 
        y: number, 
        maxWidth: number, 
        fontSize: number, 
        color: string, 
        stroke: boolean, 
        fontFamily: string, 
        shouldWrap: boolean
    ) => {
        ctx.font = `${stroke ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
        if (shouldWrap) {
             const words = text.split(' ');
             let line = '';
             const lines = [];
             for (let n = 0; n < words.length; n++) {
                 const testLine = line + words[n] + ' ';
                 const metrics = ctx.measureText(testLine);
                 if (metrics.width > maxWidth && n > 0) {
                     lines.push(line);
                     line = words[n] + ' ';
                 } else {
                     line = testLine;
                 }
             }
             lines.push(line);
             const lineHeight = fontSize * 1.35;
             ctx.textAlign = 'center';
             ctx.textBaseline = 'bottom';
             if (stroke) {
                 ctx.lineWidth = 3 * fontScale * (fontSize / 20); 
                 ctx.lineJoin = 'round';
                 ctx.strokeStyle = 'rgba(0,0,0,0.8)';
             }
             ctx.fillStyle = color;
             for (let i = 0; i < lines.length; i++) {
                 const lineY = y - ((lines.length - 1 - i) * lineHeight);
                 if (stroke) ctx.strokeText(lines[i], x, lineY);
                 ctx.fillText(lines[i], x, lineY); 
             }
             return lines.length * lineHeight;
        }
        let currentFontSize = fontSize;
        let textMetrics = ctx.measureText(text);
        if (textMetrics.width > maxWidth) {
             const scaleFactor = maxWidth / textMetrics.width;
             currentFontSize = Math.floor(fontSize * scaleFactor);
             ctx.font = `${stroke ? 'bold ' : ''}${currentFontSize}px ${fontFamily}`;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        if (stroke) {
            ctx.lineWidth = 3 * fontScale * (currentFontSize / fontSize); 
            ctx.lineJoin = 'round';
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.strokeText(text, x, y);
        }
        ctx.fillStyle = color;
        ctx.fillText(text, x, y); 
        return currentFontSize * 1.3; 
    };
    const drawFrame = () => {
        if (recorder.state !== 'recording' && recorder.state !== 'inactive') return;
        if (!offlineVideoRef.current) return;
        if (!document.body.contains(offlineVideoRef.current)) return;
        if (offlineVideo.currentTime >= offlineVideo.duration - 0.1 || offlineVideo.ended) {
            if (recorder.state === 'recording') recorder.stop();
            return;
        }
        ctx.drawImage(offlineVideo, 0, 0, canvas.width, canvas.height);
        const time = offlineVideo.currentTime;
        const sub = subtitles.find(s => time >= s.startTime && time <= s.endTime);
        const vDuration = offlineVideo.duration || 1;
        const currentProgress = Math.min(100, (time / vDuration) * 100);
        setExportProgress(currentProgress);
        if (currentProgress > 2) {
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const totalEstimatedSeconds = elapsedSeconds / (currentProgress / 100);
            const remaining = Math.max(0, totalEstimatedSeconds - elapsedSeconds);
            setExportTimeLeft(prev => {
                if (!prev) return Math.ceil(remaining);
                if (Math.abs(prev - remaining) > 0.5) return Math.ceil(remaining);
                return prev;
            });
        }
        if (sub && viewMode !== 'off') {
            const centerX = canvas.width / 2;
            const maxWidth = canvas.width * 0.9; 
            const bottomBaseY = canvas.height * (1 - (subStyle.verticalPosition / 100));
            let currentBottomY = bottomBaseY;
            if (viewMode === 'dual' || viewMode === 'cn') {
                const size = subStyle.cnSize * fontScale * 1.5; 
                const heightUsed = drawText(
                    sub.chinese, centerX, currentBottomY, maxWidth, size, subStyle.cnColor, true, '"Microsoft YaHei", sans-serif', false
                );
                currentBottomY -= heightUsed;
            }
            if (viewMode === 'dual' || viewMode === 'en') {
                if (viewMode === 'dual') currentBottomY -= (8 * fontScale);
                const size = subStyle.enSize * fontScale * 1.5;
                drawText(
                    sub.english, centerX, currentBottomY, maxWidth, size, subStyle.enColor, true, 'Inter, sans-serif', true
                );
            }
        }
        if ('requestVideoFrameCallback' in offlineVideo) {
             // @ts-ignore
             offlineVideo.requestVideoFrameCallback(drawFrame);
        } else {
             requestAnimationFrame(drawFrame);
        }
    };
    offlineVideo.currentTime = 0;
    await new Promise<void>(resolve => {
        const onSeeked = () => {
            offlineVideo.removeEventListener('seeked', onSeeked);
            resolve();
        };
        offlineVideo.addEventListener('seeked', onSeeked);
        offlineVideo.currentTime = 0;
    });
    ctx.drawImage(offlineVideo, 0, 0, canvas.width, canvas.height);
    recorder.start();
    offlineVideo.play().then(() => {
        drawFrame();
    }).catch(e => {
        console.error("Offline playback failed", e);
        cleanup();
    });
  };

  // Switch to h-[100svh] for stable viewport height on mobile
  return (
    <div className="h-[100svh] bg-[#0B0F17] text-slate-200 flex flex-col font-sans overflow-hidden">
      <canvas ref={exportCanvasRef} className="hidden" />

      {/* Exit Confirmation Modal */}
      {showExitModal && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-[#161B22] p-6 rounded-xl border border-slate-700 shadow-2xl w-full max-w-sm transform transition-all scale-100">
                <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-full bg-blue-600/20 flex items-center justify-center mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">确认退出</h3>
                    <p className="text-slate-400 text-sm mb-6">
                        您确定要退出 AutoSub 吗？<br/>
                        {(status === 'uploading' || status === 'analyzing') && (
                            <span className="text-yellow-500 block mt-1">
                                正在进行的任务将会中断，未保存的进度会丢失。
                            </span>
                        )}
                        {!(status === 'uploading' || status === 'analyzing') && subtitles.length > 0 && (
                            <span className="text-yellow-500 block mt-1">
                                未保存的进度会丢失。
                            </span>
                        )}
                    </p>
                    <div className="flex gap-3 w-full">
                        <button 
                            onClick={() => setShowExitModal(false)} 
                            className="flex-1 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors font-medium text-sm border border-slate-700"
                        >
                            取消
                        </button>
                        <button 
                            onClick={handleConfirmExit} 
                            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-medium text-sm shadow-lg shadow-blue-900/20"
                        >
                            确认退出
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Settings Modal */}
      {showApiKeyModal && (
            <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                <div className="bg-[#161B22] p-6 rounded-xl border border-slate-700 shadow-2xl w-full max-w-md">
                    <h3 className="text-xl font-bold text-white mb-2">配置 Gemini API Key</h3>
                    <p className="text-slate-400 text-sm mb-4">请粘贴您的 Google Gemini API Key 以使用服务。您的 Key 仅存储在本地浏览器缓存中。</p>
                    <input 
                        type="password"
                        value={tempApiKey}
                        onChange={(e) => setTempApiKey(e.target.value)}
                        placeholder="粘贴 API Key (AIzaSy...)"
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none mb-6 font-mono text-sm"
                    />
                    <div className="flex justify-end gap-3">
                        <button onClick={handleModalCancel} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">取消</button>
                        <button onClick={handleSaveApiKey} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">保存并继续</button>
                    </div>
                </div>
            </div>
        )}

      {/* Error Modal */}
      {errorMsg && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-[#161B22] w-full max-w-2xl rounded-xl border border-red-500/50 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
                {/* Header & Content */}
                <div className="p-4 md:p-6 pb-0 flex gap-4 flex-1 min-h-0">
                    <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                        <h3 className="text-lg font-bold text-white mb-2 flex-shrink-0">生成失败</h3>
                        <div className="flex-1 overflow-y-auto custom-scrollbar bg-black/20 rounded-lg border border-white/5 p-3">
                             <p className="text-slate-300 text-xs leading-relaxed break-words whitespace-pre-wrap font-mono select-text">
                                {errorMsg}
                             </p>
                        </div>
                    </div>
                </div>
                
                {/* Footer */}
                <div className="p-4 md:p-6 pt-4 flex justify-end gap-3 flex-shrink-0 bg-[#161B22]">
                    <button 
                        onClick={() => {
                            if (errorMsg) {
                                navigator.clipboard.writeText(errorMsg);
                                setCopySuccess(true);
                                setTimeout(() => setCopySuccess(false), 2000);
                            }
                        }}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-colors font-medium text-sm flex items-center gap-2 group whitespace-nowrap"
                    >
                        {copySuccess ? (
                             <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                <span className="text-green-500">已复制</span>
                             </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                <span>复制错误信息</span>
                            </>
                        )}
                    </button>
                    <button 
                        onClick={() => setErrorMsg(null)} 
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium text-sm whitespace-nowrap"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
      )}

      <header className="bg-[#161B22]/80 border-b border-white/5 backdrop-blur-sm sticky top-0 z-50 flex-shrink-0">
        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/30">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                AutoSub
              </h1>
            </div>
          </div>
          
          {/* Updated Header Button: Reflects Configuration State */}
          <button 
            onClick={handleOpenApiKeySettings}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all text-sm font-medium shadow-sm group ${
                hasApiKey 
                ? 'bg-[#1F2937] hover:bg-[#374151] text-green-400 border-green-500/30' 
                : 'bg-[#1F2937] hover:bg-[#374151] text-slate-200 border-slate-700/50 hover:border-blue-500/50'
            }`}
            title="配置 Gemini API Key"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={`w-4 h-4 transition-colors ${hasApiKey ? 'text-green-500' : 'text-slate-400 group-hover:text-blue-400'}`}>
              <path fillRule="evenodd" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" clipRule="evenodd" />
            </svg>
            <span>{hasApiKey ? '已配置 API Key' : '未配置 API Key'}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area - Set Height to viewport minus header */}
      {/* Reduce padding on mobile (p-2) to allow full width player */}
      <main className="flex-grow px-4 pt-8 pb-6 lg:p-6 max-w-[1920px] mx-auto w-full relative h-full lg:h-[calc(100vh-64px)] overflow-y-auto lg:overflow-hidden custom-scrollbar">
        
        {/* Floating Background Task UI */}
        {isExporting && (
            <div className="fixed bottom-6 right-6 z-[9999] w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-4 animate-slide-up flex flex-col gap-3 ring-1 ring-white/10">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                           <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                           正在后台导出视频...
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                          您可以继续预览播放，请勿刷新页面。
                        </p>
                    </div>
                    <button onClick={cancelExport} className="text-slate-500 hover:text-red-400 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
                
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                        className="bg-gradient-to-r from-blue-500 to-purple-500 h-1.5 rounded-full transition-all duration-300" 
                        style={{ width: `${exportProgress}%` }}
                    ></div>
                </div>
                
                <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-blue-400 font-bold">{Math.round(exportProgress)}%</span>
                    <span className="text-slate-400">{formatDuration(exportTimeLeft)} 剩余</span>
                </div>
            </div>
        )}

        {/* Export Success Notification */}
        {exportResult && (
             <div className="fixed bottom-6 right-6 z-[9999] w-80 bg-slate-900 border border-green-500/30 rounded-xl shadow-2xl p-4 animate-fade-in flex items-center gap-3 ring-1 ring-green-500/20">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                </div>
                <div className="flex-1">
                    <p className="text-sm font-bold text-white">{exportResult.msg}</p>
                    <p className="text-xs text-slate-400">文件已开始下载</p>
                </div>
                <button onClick={() => setExportResult(null)} className="text-slate-500 hover:text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                         <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
             </div>
        )}

        {/* Main Layout Grid - Height 100% of parent */}
        {/* Reduce gap on mobile */}
        {/* Changed from grid to flex-col on mobile to allow better height distribution */}
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-3 lg:gap-6 h-full">
          
          {/* Left Column: Player & Controls - Scrolls if needed on small screens, fixed on large */}
          {/* Remove pr-2 on mobile (pr-0) to utilize full width */}
          <div className="lg:col-span-8 flex flex-col gap-4 overflow-visible pr-0 lg:pr-2 lg:h-full flex-shrink-0">
            <Player 
              ref={videoRef}
              videoUrl={videoData.url}
              subtitles={subtitles}
              viewMode={viewMode}
              subStyle={subStyle}
              isExporting={isExporting}
              isPreviewMode={isPreviewMode}
              onTriggerFileSelect={handleTriggerFileSelect}
              onFileDrop={handleFileDrop}
              onTimeUpdate={handleTimeUpdate}
              // Switch to h-[35svh] to match root container sync
              className="w-full h-[35svh] min-h-[300px] lg:h-auto lg:flex-1 lg:min-h-0 lg:aspect-auto"
            />

            <div className="bg-[#0D1117] p-4 lg:p-5 rounded-2xl border border-white/5 shadow-xl flex-shrink-0">
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
                   <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    
                    {/* Left Group: Change Video & Regenerate - Full width on mobile, auto on desktop */}
                    <div className="w-full lg:w-auto flex gap-3 flex-shrink-0">
                        {videoData.file && (
                          <button
                            onClick={handleTriggerFileSelect}
                            className="flex-1 lg:flex-none px-6 py-2.5 bg-[#21262D] hover:bg-[#30363D] text-slate-200 rounded-lg font-medium transition-all border border-white/10 hover:border-white/20 shadow-sm text-sm whitespace-nowrap"
                          >
                            更换视频
                          </button>
                        )}

                        {videoData.file && status === 'completed' && (
                            <button
                              onClick={handleProcess}
                              className="flex-1 lg:flex-none px-6 py-2.5 bg-[#21262D] hover:bg-[#30363D] text-slate-200 rounded-lg font-medium transition-all border border-white/10 hover:border-white/20 shadow-sm text-sm whitespace-nowrap"
                            >
                              重新生成
                            </button>
                        )}
                    </div>

                    {/* Right Group: Status Indicators & Primary Action */}
                    {/* Mobile: Column layout (Stacked). Desktop: Row layout. */}
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 w-full lg:w-auto lg:justify-end">
                        
                        {/* Group Dropdowns: On mobile they share a row. On desktop they are part of the main row. */}
                        <div className="flex gap-3 w-full lg:w-auto flex-shrink-0">
                            {/* Translation Mode Selector */}
                            <div className="relative flex-1 min-w-0 lg:flex-none lg:w-auto">
                                <button 
                                    onClick={() => !isExporting && setShowTransMenu(!showTransMenu)}
                                    disabled={isExporting || (status === 'analyzing' || status === 'uploading')}
                                    className={`w-full lg:w-auto flex items-center justify-between lg:justify-start gap-2 px-3 py-2.5 bg-[#21262D] hover:bg-[#30363D] text-slate-200 rounded-lg font-medium transition-all border border-white/10 hover:border-white/20 shadow-sm text-sm whitespace-nowrap min-w-0 sm:min-w-[120px] ${
                                        (isExporting || (status === 'analyzing' || status === 'uploading')) ? 'opacity-50 cursor-not-allowed' : ''
                                    }`}
                                >
                                    <span className="truncate">{TRANS_MODES.find(m => m.id === translationMode)?.label}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform flex-shrink-0 ${showTransMenu ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                    </svg>
                                </button>
                                
                                {showTransMenu && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowTransMenu(false)}></div>
                                        {/* Changed z-20 to z-[100] */}
                                        <div className="absolute bottom-full mb-2 left-0 lg:left-auto lg:right-0 w-48 bg-[#161B22] border border-slate-700 shadow-xl rounded-lg py-1 z-[100] overflow-hidden">
                                            {TRANS_MODES.map(m => (
                                                <button 
                                                    key={m.id}
                                                    onClick={() => { setTranslationMode(m.id as TranslationMode); setShowTransMenu(false); }}
                                                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between whitespace-nowrap ${
                                                        selectedModel === m.id ? 'bg-blue-600/10 text-blue-400' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                                    }`}
                                                >
                                                    <span>{m.label}</span>
                                                    {translationMode === m.id && (
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                        </svg>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Model Selector */}
                            <div className="relative flex-1 min-w-0 lg:flex-none lg:w-auto">
                                <button 
                                    onClick={() => !isExporting && setShowModelMenu(!showModelMenu)}
                                    disabled={isExporting || (status === 'analyzing' || status === 'uploading')}
                                    className={`w-full lg:w-auto flex items-center justify-between lg:justify-start gap-2 px-3 py-2.5 bg-[#21262D] hover:bg-[#30363D] text-slate-200 rounded-lg font-medium transition-all border border-white/10 hover:border-white/20 shadow-sm text-sm whitespace-nowrap min-w-0 sm:min-w-[140px] ${
                                        (isExporting || (status === 'analyzing' || status === 'uploading')) ? 'opacity-50 cursor-not-allowed' : ''
                                    }`}
                                >
                                    <span className="truncate">{MODELS.find(m => m.id === selectedModel)?.label.split(' ')[0]}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform flex-shrink-0 ${showModelMenu ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                    </svg>
                                </button>
                                
                                {showModelMenu && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowModelMenu(false)}></div>
                                        {/* Changed z-20 to z-[100] */}
                                        <div className="absolute bottom-full mb-2 right-0 w-64 bg-[#161B22] border border-slate-700 shadow-xl rounded-lg py-1 z-[100] max-h-60 overflow-y-auto custom-scrollbar">
                                            {MODELS.map(m => (
                                                <button 
                                                    key={m.id}
                                                    disabled={m.disabled}
                                                    onClick={() => { setSelectedModel(m.id); setShowModelMenu(false); }}
                                                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between whitespace-nowrap ${
                                                        m.disabled 
                                                        ? 'text-slate-600 cursor-not-allowed bg-slate-900/50' 
                                                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                                    } ${selectedModel === m.id ? 'bg-blue-600/10 text-blue-400' : ''}`}
                                                >
                                                    <span>{m.label}</span>
                                                    {selectedModel === m.id && (
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                        </svg>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {(status === 'analyzing' || status === 'uploading') && (
                             <div className="w-full lg:w-auto flex items-center gap-3 text-blue-400 font-medium animate-pulse bg-blue-900/20 px-4 py-2 rounded-lg border border-blue-800/50 flex-shrink-0">
                               <svg className="animate-spin h-5 w-5 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                               </svg>
                               <div className="flex flex-col">
                                   <span className="text-sm whitespace-nowrap">
                                       {status === 'uploading' ? '正在上传视频...' : 'AI 正在分析...'}
                                   </span>
                                   {status === 'uploading' && videoData.file && (
                                       <span className="text-xs text-blue-300/70 font-normal whitespace-nowrap">
                                          {(videoData.file.size / (1024 * 1024)).toFixed(1)} MB • {uploadElapsed}s
                                       </span>
                                   )}
                               </div>
                             </div>
                        )}

                        {/* Start Button - Full Width on Mobile, Auto on Desktop */}
                        {(status === 'idle' || status === 'error') && (
                         <button
                           onClick={handleProcess}
                           disabled={!videoData.file}
                           className={`w-full lg:w-auto px-8 py-2.5 rounded-lg font-bold transition-all shadow-lg hover:shadow-blue-500/20 hover:-translate-y-0.5 text-sm whitespace-nowrap flex-shrink-0 ${
                             !videoData.file
                               ? 'bg-[#21262D] text-slate-600 cursor-not-allowed border border-white/5'
                               : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/30'
                           }`}
                         >
                           {status === 'error' ? '重试生成' : '开始 AI 生成字幕'}
                         </button>
                        )}

                        {/* Completed State Actions */}
                        {status === 'completed' && (
                          <div className="flex gap-2 w-full lg:w-auto flex-shrink-0">
                              <button
                                onClick={downloadSRT}
                                className="flex-1 lg:flex-none px-4 py-2.5 bg-[#21262D] hover:bg-[#30363D] text-slate-300 rounded-lg text-sm border border-white/10 transition-colors whitespace-nowrap"
                              >
                                下载 SRT
                              </button>
                              
                              {/* Export Format Selector */}
                              <div className="relative flex-1 lg:flex-none">
                                <button 
                                    onClick={() => !isExporting && setShowExportMenu(!showExportMenu)}
                                    disabled={isExporting}
                                    className={`w-full lg:w-auto flex items-center justify-between lg:justify-start gap-2 px-3 py-2.5 bg-[#21262D] hover:bg-[#30363D] text-slate-200 rounded-lg font-medium transition-all border border-white/10 hover:border-white/20 shadow-sm text-sm whitespace-nowrap min-w-[90px] ${
                                        isExporting ? 'opacity-50 cursor-not-allowed' : ''
                                    }`}
                                >
                                    <span className="truncate">{EXPORT_FORMATS.find(f => f.id === exportFormat)?.label}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform flex-shrink-0 ${showExportMenu ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                    </svg>
                                </button>
                                
                                {showExportMenu && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)}></div>
                                        {/* Changed z-20 to z-[100] */}
                                        <div className="absolute bottom-full mb-2 right-0 w-32 bg-[#161B22] border border-slate-700 shadow-xl rounded-lg py-1 z-[100] overflow-hidden">
                                            {EXPORT_FORMATS.map(f => (
                                                <button 
                                                    key={f.id}
                                                    onClick={() => { setExportFormat(f.id as ExportFormat); setShowExportMenu(false); }}
                                                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between whitespace-nowrap ${
                                                        exportFormat === f.id ? 'bg-blue-600/10 text-blue-400' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                                    }`}
                                                >
                                                    <span>{f.label}</span>
                                                    {exportFormat === f.id && (
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                        </svg>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                              </div>

                              <button
                                onClick={handleExportBurned}
                                disabled={isExporting}
                                className={`flex-1 lg:flex-none px-3 py-2.5 text-sm rounded-lg transition-colors shadow-sm font-medium whitespace-nowrap ${
                                    isExporting 
                                    ? 'text-slate-500 cursor-not-allowed bg-slate-800'
                                    : 'bg-blue-600 text-white hover:bg-blue-500'
                                }`}
                              >
                                {isExporting ? '导出中...' : '导出视频'}
                              </button>
                          </div>
                        )}
                    </div>
                </div>
            </div>
          </div>

          {/* Right Column: Subtitle List & Settings - Scrolls if needed on small screens */}
          {/* Hide scrollbar visually but allow scrolling on mobile */}
          <div className="lg:col-span-4 flex flex-col gap-2 lg:gap-4 h-auto lg:h-full lg:overflow-hidden">
            
            {/* Settings Panel - Collapsible */}
            <div className="flex-shrink-0 bg-[#161B22] rounded-xl border border-white/5 shadow-lg overflow-hidden">
                <button 
                    onClick={() => setIsControlPanelOpen(!isControlPanelOpen)}
                    className={`w-full flex items-center justify-between p-3 lg:p-4 bg-[#1F2937]/50 hover:bg-[#1F2937] transition-colors lg:pointer-events-none lg:bg-transparent lg:border-b lg:border-white/5 ${!isControlPanelOpen ? 'rounded-b-xl lg:rounded-none' : ''}`}
                >
                    <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                        </svg>
                        视图控制
                    </h3>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-slate-400 transition-transform duration-200 lg:hidden ${isControlPanelOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
                
                <div className={`${isControlPanelOpen ? 'block' : 'hidden'} lg:block bg-[#161B22]`}>
                    <div className="p-4 pt-0 border-t border-white/5 mt-3 lg:border-none lg:pt-4 lg:mt-0">
                        <div className="flex items-center justify-end mb-3">
                            <button
                                onClick={() => setIsPreviewMode(!isPreviewMode)}
                                className={`text-xs px-2 py-1 rounded transition-colors border flex items-center gap-1 ${
                                    isPreviewMode 
                                    ? 'bg-blue-600 border-blue-500 text-white' 
                                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                }`}
                            >
                                {isPreviewMode ? '关闭预览' : '预览样式'}
                            </button>
                        </div>
                        
                        <div className="flex bg-slate-800/50 p-1 rounded-lg mb-4">
                            {(['dual', 'cn', 'en', 'off'] as SubtitleViewMode[]).map((mode) => (
                                <button
                                    key={mode}
                                    onClick={() => setViewMode(mode)}
                                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                                        viewMode === mode 
                                        ? 'bg-blue-600 text-white shadow-sm' 
                                        : 'text-slate-400 hover:text-slate-200 hover:text-slate-200 hover:bg-slate-700/50'
                                    }`}
                                >
                                    {mode === 'dual' ? '双语' : mode === 'cn' ? '仅中文' : mode === 'en' ? '仅英文' : '关闭'}
                                </button>
                            ))}
                        </div>

                        <div className="space-y-3">
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-400">位置</span>
                                    <span className="text-xs font-mono text-blue-400">{subStyle.verticalPosition}%</span>
                                </div>
                                <input 
                                    type="range" min="0" max="50" 
                                    value={subStyle.verticalPosition}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        setSubStyle(prev => ({...prev, verticalPosition: val}));
                                    }}
                                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400">中文</span>
                                        <span className="text-xs font-mono text-blue-400">{subStyle.cnSize}px</span>
                                    </div>
                                    <input type="color" value={subStyle.cnColor} onChange={(e) => {
                                        const val = e.target.value;
                                        setSubStyle(prev => ({...prev, cnColor: val}));
                                    }} className="h-4 w-4 rounded cursor-pointer border-0 bg-transparent p-0" />
                                </div>
                                <input 
                                    type="range" min="10" max="60" 
                                    value={subStyle.cnSize}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        setSubStyle(prev => ({...prev, cnSize: val}));
                                    }}
                                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400">英文</span>
                                        <span className="text-xs font-mono text-blue-400">{subStyle.enSize}px</span>
                                    </div>
                                    <input type="color" value={subStyle.enColor} onChange={(e) => {
                                        const val = e.target.value;
                                        setSubStyle(prev => ({...prev, enColor: val}));
                                    }} className="h-4 w-4 rounded cursor-pointer border-0 bg-transparent p-0" />
                                </div>
                                <input 
                                    type="range" min="10" max="60" 
                                    value={subStyle.enSize}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        setSubStyle(prev => ({...prev, enSize: val}));
                                    }}
                                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full"
                                />
                            </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Subtitle List Component - Flex Grow to fill remaining height if open */}
            <div className={`flex flex-col ${isSubtitleListOpen ? 'flex-1 min-h-[300px]' : 'flex-none'} lg:flex-1 lg:h-full lg:min-h-0 transition-none`}>
                 <div className={`bg-[#161B22] border border-white/5 rounded-t-xl overflow-hidden flex-shrink-0 lg:hidden ${!isSubtitleListOpen ? 'rounded-b-xl' : ''}`}>
                    <button 
                        onClick={() => setIsSubtitleListOpen(!isSubtitleListOpen)}
                        className={`w-full flex items-center justify-between p-3 lg:p-4 bg-[#1F2937]/50 hover:bg-[#1F2937] transition-colors ${!isSubtitleListOpen ? 'rounded-b-xl' : ''}`}
                    >
                        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                            </svg>
                            字幕列表 {subtitles.length > 0 && `(${subtitles.length})`}
                        </h3>
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-slate-400 transition-transform duration-200 ${isSubtitleListOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                 </div>
                 
                 <div className={`flex-1 overflow-hidden min-h-0 border-x border-b border-white/5 rounded-b-xl lg:border-none lg:rounded-none bg-[#161B22] ${isSubtitleListOpen ? 'flex flex-col w-full' : 'hidden'} lg:flex lg:flex-col lg:w-full`}>
                        <SubtitleList 
                            subtitles={subtitles}
                            currentTime={currentTime}
                            onSeek={handleSeek}
                        />
                 </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
};