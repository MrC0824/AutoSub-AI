import React, { useRef, useEffect } from 'react';
import { SubtitleSegment } from '../types';

interface SubtitleListProps {
  subtitles: SubtitleSegment[];
  currentTime: number;
  onSeek: (time: number) => void;
}

// Memoized Item Component to prevent re-rendering the entire list when only one item changes
const SubtitleItem = React.memo(({ 
  sub, 
  isActive, 
  onSeek,
  formatTime 
}: { 
  sub: SubtitleSegment, 
  isActive: boolean, 
  onSeek: (time: number) => void,
  formatTime: (s: number) => string
}) => {
  const activeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active element using scrollTo instead of scrollIntoView
  // to avoid parent container scrolling/shaking
  useEffect(() => {
    if (isActive && activeRef.current) {
        const el = activeRef.current;
        const container = el.parentElement;
        if (container) {
            const containerHeight = container.clientHeight;
            const elementTop = el.offsetTop;
            const elementHeight = el.clientHeight;
            
            // Calculate centered position
            const scrollTo = elementTop - (containerHeight / 2) + (elementHeight / 2);
            
            container.scrollTo({
                top: scrollTo,
                behavior: 'smooth'
            });
        }
    }
  }, [isActive]);
  
  return (
    <div
      ref={isActive ? activeRef : null}
      onClick={() => onSeek(sub.startTime)}
      className={`p-3 rounded-lg cursor-pointer transition-all duration-200 border ${
        isActive
          ? 'bg-indigo-600/20 border-indigo-500 shadow-md'
          : 'bg-slate-700/30 border-transparent hover:bg-slate-700/50 hover:border-slate-600'
      }`}
    >
      <div className="flex justify-between items-center mb-1">
        <span className={`text-xs font-mono ${isActive ? 'text-indigo-300' : 'text-slate-500'}`}>
          {formatTime(sub.startTime)} - {formatTime(sub.endTime)}
        </span>
      </div>
      <p className={`text-sm mb-1 leading-relaxed ${isActive ? 'text-white' : 'text-slate-300'}`}>
        {sub.english}
      </p>
      <p className={`text-sm font-medium leading-relaxed ${isActive ? 'text-yellow-300' : 'text-yellow-600/80'}`}>
        {sub.chinese}
      </p>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for React.memo
  return (
    prevProps.isActive === nextProps.isActive &&
    prevProps.sub === nextProps.sub
  );
});

export const SubtitleList: React.FC<SubtitleListProps> = ({ subtitles, currentTime, onSeek }) => {
  const listRef = useRef<HTMLDivElement>(null);

  const formatTime = (seconds: number) => {
    const date = new Date(0);
    date.setSeconds(seconds);
    // Handle cases where time might be negative or tiny due to float math
    const safeSeconds = Math.max(0, seconds);
    return new Date(safeSeconds * 1000).toISOString().substr(14, 5);
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-xl">
      <div className="p-4 bg-slate-900 border-b border-slate-700 flex justify-between items-center flex-shrink-0">
        <h3 className="font-semibold text-lg text-white">字幕列表</h3>
        <span className="text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded">
          {subtitles.length} 段
        </span>
      </div>
      
      {/* Scrollable Area */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar relative">
        {subtitles.length === 0 ? (
          <div className="text-center text-slate-500 mt-10 text-sm">
            生成的字幕将显示在这里。<br/>点击时间轴可跳转视频。
          </div>
        ) : (
          subtitles.map((sub, index) => {
            const isActive = currentTime >= sub.startTime && currentTime <= sub.endTime;
            return (
              <SubtitleItem 
                key={index}
                sub={sub}
                isActive={isActive}
                onSeek={onSeek}
                formatTime={formatTime}
              />
            );
          })
        )}
      </div>
    </div>
  );
};