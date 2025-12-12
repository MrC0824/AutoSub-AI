import { GoogleGenAI, Type } from "@google/genai";
import { ProcessingStatus, SubtitleSegment, TranslationMode } from "../types";

// Helper to convert File to Base64 string
const fileToBase64 = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // remove data:video/mp4;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Post-processing to ensure strictly sequential and non-overlapping subtitles
// AND aggressively split long segments to prevent "frozen" UI
const postProcessSubtitles = (subtitles: SubtitleSegment[]): SubtitleSegment[] => {
  if (!subtitles || subtitles.length === 0) return [];

  // 1. Sort by start time to ensure sequence
  let sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);
  const processed: SubtitleSegment[] = [];

  // 2. Aggressive splitting of long segments
  const MAX_DURATION = 6.0; 

  for (const segment of sorted) {
    const duration = segment.endTime - segment.startTime;
    
    // Safety fix: Ensure endTime > startTime
    if (duration <= 0) {
        segment.endTime = segment.startTime + 1.0;
    }

    if (duration > MAX_DURATION) {
        // Split logic
        const enWords = segment.english.split(' ');
        const cnText = segment.chinese; // Chinese is harder to split by space
        
        const chunkCount = Math.ceil(duration / 3.0); 
        const chunkDuration = duration / chunkCount;
        
        const enWordsPerChunk = Math.ceil(enWords.length / chunkCount);
        const cnCharsPerChunk = Math.ceil(cnText.length / chunkCount);

        for (let k = 0; k < chunkCount; k++) {
            const startT = segment.startTime + (k * chunkDuration);
            const endT = segment.startTime + ((k + 1) * chunkDuration);
            
            // Slice English words
            const startEn = k * enWordsPerChunk;
            const endEn = Math.min((k + 1) * enWordsPerChunk, enWords.length);
            const enPart = enWords.slice(startEn, endEn).join(' ');

            // Slice Chinese chars
            const startCn = k * cnCharsPerChunk;
            const endCn = Math.min((k + 1) * cnCharsPerChunk, cnText.length);
            const cnPart = cnText.substring(startCn, endCn);

            if (enPart.trim() || cnPart.trim()) {
                processed.push({
                    startTime: Number(startT.toFixed(3)),
                    endTime: Number(endT.toFixed(3)),
                    english: enPart,
                    chinese: cnPart
                });
            }
        }
    } else {
        processed.push(segment);
    }
  }

  // 3. Fix overlaps and sequential timing
  for (let i = 0; i < processed.length; i++) {
    const current = processed[i];
    
    if (i < processed.length - 1) {
      const next = processed[i + 1];
      // If current segment runs into the next one, trim it
      if (current.endTime > next.startTime) {
        current.endTime = next.startTime;
      }
    }
  }

  return processed;
};

// Updated signature to accept modelName and translationMode
export const generateSubtitles = async (
    file: File, 
    modelName: string, 
    translationMode: TranslationMode,
    onProgress?: (status: ProcessingStatus) => void
): Promise<SubtitleSegment[]> => {
  // Access API key safely. 
  let apiKey = process.env.API_KEY || 
                 (window as any).process?.env?.API_KEY || 
                 localStorage.getItem('GEMINI_API_KEY');

  // Modified logic for Web Bypass:
  if (!apiKey) {
     console.warn("No API Key found. Using placeholder for validation bypass.");
     apiKey = "BYPASS_CHECK_PLACEHOLDER_KEY";
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });

  // Schema for structured output
  const responseSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        startTime: {
          type: Type.NUMBER,
          description: "Start time in seconds (e.g. 12.45).",
        },
        endTime: {
          type: Type.NUMBER,
          description: "End time in seconds (e.g. 15.20).",
        },
        english: {
          type: Type.STRING,
          description: "English text content (transcription or translation).",
        },
        chinese: {
          type: Type.STRING,
          description: "Chinese text content (transcription or translation).",
        },
      },
      required: ["startTime", "endTime", "english", "chinese"],
    },
  };

  const taskInstruction = translationMode === 'en_to_cn' 
      ? "Transcribe the English audio and translate it to Simplified Chinese."
      : "Transcribe the Chinese audio and translate it to English.";

  const systemInstruction = `You are a professional video subtitler obsessed with frame-perfect audio synchronization.
        
  TASK:
  1. ${taskInstruction}
  2. Output a JSON array of subtitle segments.

  CRITICAL RULES FOR 100% SYNC (STRICT ADHERENCE REQUIRED):
  1. **FRAME-PERFECT TIMING**: 
     - 'startTime' must match the EXACT millisecond the voice starts visible on the waveform.
     - 'endTime' must match the EXACT millisecond the voice stops.
     - **DO NOT** add buffer time. Precision is key.
  2. **SEGMENTATION BALANCE**:
     - **Target Duration**: 3 to 5 seconds per segment.
     - **Max Duration**: 6 seconds. (Strict limit).
     - **Min Duration**: 1.5 seconds.
     - **Max Length**: 12-14 words per line.
  3. **FAST SPEECH**: If speech is fast, DO NOT merge sentences. You MUST split them based on grammatical pauses.
  4. **NO OVERLAPS**: Subtitles must be strictly sequential.
  5. **SINGLE LINE**: Visuals must be clean. No paragraphs.
  6. **VAD SIMULATION**: If there is silence, close the subtitle segment immediately.

  Your goal is "Karaoke-level" timing precision.`;

  try {
    const INLINE_LIMIT_BYTES = 20 * 1024 * 1024; // 20 MB

    let response;

    if (file.size < INLINE_LIMIT_BYTES) {
        if (onProgress) onProgress('analyzing');
        const base64Data = await fileToBase64(file);
        
        response = await ai.models.generateContent({
            model: modelName, // Use the dynamic model passed from UI
            contents: {
                parts: [
                    {
                        inlineData: {
                            mimeType: file.type || "video/mp4",
                            data: base64Data
                        }
                    },
                    { text: "Generate strictly synced bilingual subtitles in JSON format." }
                ]
            },
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema,
                temperature: 0.0,
            }
        });

    } else {
        // --- LARGE FILE FLOW (Files API) ---
        let uploadResult;
        let retries = 3;
        while (retries > 0) {
            try {
                uploadResult = await ai.files.upload({
                    file: file,
                    config: { 
                        displayName: file.name,
                        mimeType: file.type || "video/mp4",
                    }
                });
                break; // Success
            } catch (e) {
                retries--;
                if (retries === 0) throw e;
                console.warn(`Upload failed, retrying... (${retries} attempts left)`, e);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!uploadResult) throw new Error("Upload failed after retries.");

        const fileObj = uploadResult;
        const fileUri = fileObj.uri;
        const fileName = fileObj.name;

        // Wait for processing
        let fileState = fileObj.state;
        while (fileState === 'PROCESSING') {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const fileInfo = await ai.files.get({ name: fileName });
            fileState = fileInfo.state;
        }

        if (fileState === 'FAILED') {
            throw new Error("Video processing failed on Google servers.");
        }

        if (onProgress) onProgress('analyzing');

        response = await ai.models.generateContent({
            model: modelName, // Use the dynamic model passed from UI
            contents: {
                parts: [
                    {
                        fileData: {
                            mimeType: fileObj.mimeType,
                            fileUri: fileUri
                        }
                    },
                    { text: "Generate strictly synced bilingual subtitles in JSON format." }
                ]
            },
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema,
                temperature: 0.0,
            }
        });

        // Cleanup
        ai.files.delete({ name: fileName }).catch(e => console.warn("Background file cleanup failed:", e));
    }

    let jsonText = response.text;
    if (!jsonText) {
      throw new Error("Empty response from Gemini API.");
    }

    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const rawSubtitles = JSON.parse(jsonText) as SubtitleSegment[];
    
    // Apply post-processing for perfect sync and sorting
    return postProcessSubtitles(rawSubtitles);

  } catch (error: any) {
    console.error("Gemini API Error Details:", error);
    throw error;
  }
};