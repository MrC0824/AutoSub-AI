
export interface SubtitleSegment {
  startTime: number; // in seconds
  endTime: number; // in seconds
  english: string;
  chinese: string;
}

export type ProcessingStatus = 'idle' | 'uploading' | 'analyzing' | 'completed' | 'error';

export type SubtitleViewMode = 'dual' | 'en' | 'cn' | 'off';

export type TranslationMode = 'en_to_cn' | 'cn_to_en';

export interface VideoData {
  file: File | null;
  url: string | null;
  duration: number;
}

export interface SubtitleStyle {
  enSize: number;
  cnSize: number;
  enColor: string;
  cnColor: string;
  verticalPosition: number; // Percentage from bottom (0-100)
}

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  
  interface Window {
    aistudio?: AIStudio;
  }
}