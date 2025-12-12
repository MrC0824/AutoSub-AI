import React from 'react';
import { SubtitleSegment, SubtitleViewMode, SubtitleStyle } from '../types';

interface SubtitleOverlayProps {
  activeSubtitle: SubtitleSegment | null;
  viewMode: SubtitleViewMode;
  style: SubtitleStyle;
}

export const SubtitleOverlay = React.memo<SubtitleOverlayProps>(({ activeSubtitle, viewMode, style }) => {
  if (!activeSubtitle || viewMode === 'off') return null;

  // Strong text outline/shadow for readability on transparent background
  // Simulates a black stroke + soft drop shadow
  const textShadowStyle = `
    2px 2px 0 rgba(0,0,0,0.8),
    -1.5px -1.5px 0 rgba(0,0,0,0.8),
    1.5px -1.5px 0 rgba(0,0,0,0.8),
    -1.5px 1.5px 0 rgba(0,0,0,0.8),
    1.5px 1.5px 0 rgba(0,0,0,0.8),
    0px 2px 4px rgba(0,0,0,0.8)
  `.replace(/\s+/g, ' ').trim();

  return (
    <div 
      className="absolute left-0 right-0 flex flex-col items-center pointer-events-none z-50 space-y-1 transition-all duration-300 will-change-transform"
      style={{ bottom: `${style.verticalPosition}%` }}
    >
      
      {/* English Subtitle */}
      {(viewMode === 'dual' || viewMode === 'en') && (
        <div 
          className="font-medium text-center whitespace-pre-wrap max-w-[95%] break-words leading-relaxed px-4"
          style={{
            color: style.enColor,
            fontSize: `${style.enSize}px`,
            textShadow: textShadowStyle
          }}
        >
          {activeSubtitle.english}
        </div>
      )}
      
      {/* Chinese Subtitle */}
      {(viewMode === 'dual' || viewMode === 'cn') && (
        <div 
          className="font-bold tracking-wide text-center whitespace-pre-wrap max-w-[95%] break-words leading-relaxed px-4"
          style={{
            color: style.cnColor,
            fontSize: `${style.cnSize}px`,
            textShadow: textShadowStyle,
          }}
        >
          {activeSubtitle.chinese}
        </div>
      )}
    </div>
  );
});