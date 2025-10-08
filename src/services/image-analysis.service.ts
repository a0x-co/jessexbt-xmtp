import sharp from 'sharp';
import { logger } from '../config/logger.js';

export interface ImageAnalysisResult {
  success: boolean;
  analysis?: string;
  error?: string;
}

/**
 * Service for analyzing images using Gemini Vision API
 * Handles image compression and direct Gemini API calls
 */
export class ImageAnalysisService {
  private geminiApiKey: string;
  private readonly COMPRESSION_THRESHOLD = 20 * 1024 * 1024; // 20MB
  private readonly TARGET_SIZE = 10 * 1024 * 1024; // 10MB target after compression
  private readonly MAX_IMAGE_SIZE = 100 * 1024 * 1024; // 100MB absolute max

  constructor() {
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
    if (!this.geminiApiKey) {
      logger.warn('⚠️ GEMINI_API_KEY not set, image analysis will be disabled');
    }
  }

  /**
   * Analyzes an attachment (image) and returns analysis text
   * @param attachment Decoded attachment from RemoteAttachmentCodec.load()
   * @returns Analysis result with text or error
   */
  async analyzeAttachment(attachment: { data: Uint8Array; filename: string; mimeType: string }): Promise<ImageAnalysisResult> {
    if (!this.geminiApiKey) {
      return {
        success: false,
        error: 'GEMINI_API_KEY not configured'
      };
    }

    try {
      logger.info('🖼️ Starting image analysis', {
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.data.length
      });

      // 1. Validate size
      if (attachment.data.length > this.MAX_IMAGE_SIZE) {
        return {
          success: false,
          error: `Image too large: ${Math.round(attachment.data.length / 1024 / 1024)}MB (max: ${this.MAX_IMAGE_SIZE / 1024 / 1024}MB)`
        };
      }

      // 2. Get buffer
      const originalBuffer = Buffer.from(attachment.data);
      const originalSize = originalBuffer.length;
      let finalBuffer: Buffer = originalBuffer;

      // 3. Compress if needed
      if (originalBuffer.length > this.COMPRESSION_THRESHOLD) {
        logger.info(`📉 Image size ${Math.round(originalBuffer.length / 1024 / 1024)}MB exceeds threshold, compressing...`);

        try {
          // Calculate quality to reach target size
          const quality = Math.max(20, Math.min(80, Math.round((this.TARGET_SIZE / originalBuffer.length) * 100)));

          const compressedBuffer = await sharp(originalBuffer)
            .jpeg({ quality, progressive: true })
            .toBuffer();
          finalBuffer = Buffer.from(compressedBuffer);

          logger.info('✅ Compression successful', {
            originalMB: Math.round(originalSize / 1024 / 1024),
            compressedMB: Math.round(finalBuffer.length / 1024 / 1024),
            quality: `${quality}%`
          });
        } catch (compressionError) {
          logger.warn('⚠️ Compression failed, using original image', { compressionError });
          finalBuffer = originalBuffer;
        }
      }

      // 4. Convert to base64
      const base64Image = finalBuffer.toString('base64');

      logger.info('✅ Image prepared for analysis', {
        base64Length: base64Image.length,
        finalSizeMB: Math.round(finalBuffer.length / 1024 / 1024)
      });

      // 5. Call Gemini API
      const analysis = await this.callGeminiAPI(base64Image, attachment.mimeType);

      logger.info('✅ Image analysis complete', {
        analysisLength: analysis.length
      });

      return {
        success: true,
        analysis: analysis.trim()
      };

    } catch (error) {
      logger.error('❌ Image analysis failed', {
        error: error instanceof Error ? error.message : String(error),
        filename: attachment.filename
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Analysis failed'
      };
    }
  }

  /**
   * Calls Gemini API directly with base64 image
   * @param base64Image Base64 encoded image
   * @param mimeType Image MIME type
   * @returns Analysis text from Gemini
   */
  private async callGeminiAPI(base64Image: string, mimeType: string): Promise<string> {
    const prompt = `Provide a comprehensive analysis of this image. Include ALL of the following details:

1. **Visual Content**: Describe what is shown - people, objects, scenes, layout, composition
2. **Text Content**: Extract and transcribe ANY text visible including:
   - Document content, letters, emails, messages
   - Code, technical diagrams, flowcharts, UML diagrams
   - UI elements, buttons, labels, titles, headings
   - Handwritten notes, signatures, annotations
3. **Technical Elements**: If this contains technical content, explain:
   - Diagrams, charts, graphs, technical drawings
   - Code structure, programming concepts, system architecture
   - Data visualizations, mathematical formulas
4. **Context & Purpose**: What is the likely purpose or context of this image?
5. **Key Information**: What are the most important details someone would need to know?

Be thorough and specific. This analysis will help someone understand the complete content without seeing the image.`;

    logger.info('🤖 Calling Gemini API for image analysis');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.geminiApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.4,
            topK: 32,
            topP: 1,
            maxOutputTokens: 2048,
          },
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data: any = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No analysis returned from Gemini API');
    }

    const analysis = data.candidates[0]?.content?.parts?.[0]?.text;

    if (!analysis) {
      throw new Error('Empty analysis from Gemini API');
    }

    return analysis;
  }

  /**
   * Formats analysis result for backend consumption
   * Returns formatted string that backend can parse
   * @param result Analysis result
   * @param filename Original filename
   * @returns Formatted message string
   */
  formatForBackend(result: ImageAnalysisResult, filename: string): string {
    // Simple descriptive message - agent will respond based on personality
    // Same format as Telegram/Farcaster: just state user shared image
    let message = `User shared an image`;

    if (result.success && result.analysis) {
      message += `\n\n[Image Analysis: ${result.analysis}]`;
    } else if (result.error) {
      message += `\n\n[Image analysis failed: ${result.error}]`;
    } else {
      message += `\n\n[Image received but analysis unavailable]`;
    }

    return message;
  }
}