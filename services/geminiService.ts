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
const postProcessSubtitles = (subtitles: SubtitleSegment[]): SubtitleSegment[] => {
  if (!subtitles || subtitles.length === 0) return [];

  // 1. Sort by start time to ensure sequence
  let sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);
  const processed: SubtitleSegment[] = [];

  // 2. Validate and Fix overlap
  // We removed the aggressive splitting logic because it was breaking Chinese words arbitrarily.
  // We now trust the model's segmentation based on the strict system instructions.
  
  for (let i = 0; i < sorted.length; i++) {
    const segment = sorted[i];
    
    // Safety: Ensure endTime > startTime
    if (segment.endTime <= segment.startTime) {
        segment.endTime = segment.startTime + 1.5;
    }

    processed.push(segment);
  }

  // 3. Fix overlaps and sequential timing
  for (let i = 0; i < processed.length; i++) {
    const current = processed[i];
    
    if (i < processed.length - 1) {
      const next = processed[i + 1];
      
      // If current segment runs into the next one, trim it
      if (current.endTime > next.startTime) {
        // If the overlap is tiny, just trim current
        if (current.endTime - next.startTime < 1.0) {
            current.endTime = next.startTime;
        } else {
            // If overlap is large, it might be a hallucination or bad timing.
            // Adjust current end to next start to avoid visual clash.
            current.endTime = next.startTime;
        }
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
          description: "Chinese text content (transcription or translation). MUST BE Simplified Chinese (zh-CN).",
        },
      },
      required: ["startTime", "endTime", "english", "chinese"],
    },
  };

  const taskInstruction = translationMode === 'en_to_cn' 
      ? "Transcribe the English audio and translate it to Simplified Chinese (zh-CN). Use standard Mainland China terminology. Do NOT use Traditional Chinese."
      : "Transcribe the Chinese audio into Simplified Chinese (zh-CN) text and translate it to English. The Chinese transcription must be in Simplified characters.";

  const systemInstruction = `You are a professional video subtitler.
        
  TASK:
  1. ${taskInstruction}
  2. Output a JSON array of subtitle segments.

  CRITICAL RULES FOR LANGUAGE (STRICT):
  - **SIMPLIFIED CHINESE ONLY**: All Chinese text output MUST be in Simplified Chinese (zh-CN).
  - If the source audio or text is Traditional Chinese, you MUST convert it to Simplified Chinese.
  - Use Mainland China vocabulary (e.g., "视频" not "影片", "软件" not "软体").

  CRITICAL RULES FOR TIMING AND SEGMENTATION:
  1. **Split sentences naturally**: Do NOT put an entire paragraph in one subtitle. Split long sentences into multiple segments based on natural pauses and grammar.
  2. **Max Duration**: Each segment should ideally be between 2 to 5 seconds. NEVER exceed 7 seconds.
  3. **No word breaking**: When splitting Chinese text, NEVER split in the middle of a word or phrase.
  4. **Precise Timing**: Sync 'startTime' and 'endTime' exactly with the voice.
  5. **No Overlaps**: Ensure segments do not overlap in time.

  Your goal is clean, readable, Simplified Chinese subtitles.`;

  try {
    const INLINE_LIMIT_BYTES = 20 * 1024 * 1024; // 20 MB
    
    // Explicit prompt to reinforce the system instruction
    const userPrompt = `Generate strictly synced bilingual subtitles in JSON format.
    REQUIREMENTS:
    1. Translate/Transcribe to Simplified Chinese (zh-CN) ONLY.
    2. Convert any Traditional Chinese to Simplified.
    3. Keep segments short (max 6 seconds) but split naturally at grammatical points.`;

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
                    { text: userPrompt }
                ]
            },
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema,
                temperature: 0.1, // Lower temperature for more consistent following of rules
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
                    { text: userPrompt }
                ]
            },
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema,
                temperature: 0.1,
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