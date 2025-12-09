import React from 'react';
import { SubtitleSegment, SubtitleViewMode, SubtitleStyle } from '../types';

interface SubtitleOverlayProps {
  activeSubtitle: SubtitleSegment | null;
  viewMode: SubtitleViewMode;
  style: SubtitleStyle;
}

export const SubtitleOverlay = React.memo<SubtitleOverlayProps>(({ activeSubtitle, viewMode, style }) => {
  if (!activeSubtitle || viewMode === 'off') return null;

  return (
    <div 
      className="absolute left-0 right-0 flex flex-col items-center pointer-events-none z-20 space-y-2 transition-all duration-300 will-change-transform"
      style={{ bottom: `${style.verticalPosition}%` }}
    >
      
      {/* English Subtitle */}
      {(viewMode === 'dual' || viewMode === 'en') && (
        <div 
          className="bg-black/70 px-6 py-2 rounded-lg font-medium shadow-lg text-center whitespace-pre-wrap max-w-[95%] break-words leading-relaxed"
          style={{
            color: style.enColor,
            fontSize: `${style.enSize}px`,
          }}
        >
          {activeSubtitle.english}
        </div>
      )}
      
      {/* Chinese Subtitle */}
      {(viewMode === 'dual' || viewMode === 'cn') && (
        <div 
          className="bg-black/70 px-6 py-1.5 rounded-lg font-bold shadow-lg tracking-wide text-center whitespace-pre-wrap max-w-[95%] break-words leading-relaxed"
          style={{
            color: style.cnColor,
            fontSize: `${style.cnSize}px`,
            textShadow: '0px 2px 4px rgba(0,0,0,0.8)',
          }}
        >
          {activeSubtitle.chinese}
        </div>
      )}
    </div>
  );
});