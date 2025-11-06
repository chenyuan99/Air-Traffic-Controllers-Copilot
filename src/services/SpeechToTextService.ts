import { IService, ILogger, IConfigService } from '../interfaces/IService';
import { RadioTransmission } from '../types';
import { OpenAIService } from './OpenAIService';
import { EventEmitter } from '../core/EventEmitter';

export interface AudioChunk {
  id: string;
  audioData: Buffer;
  frequency: string;
  timestamp: Date;
  duration: number;
}

export interface TranscriptionResult {
  id: string;
  transcription: string;
  confidence: number;
  processingTime: number;
  audioQuality: AudioQualityMetrics;
}

export interface AudioQualityMetrics {
  signalToNoiseRatio: number;
  clarity: number;
  volume: number;
  hasClipping: boolean;
}

export class SpeechToTextService implements IService {
  private openAIService: OpenAIService;
  private logger: ILogger;
  private config: IConfigService;
  private eventEmitter: EventEmitter;
  private isProcessing = false;
  private audioQueue: AudioChunk[] = [];
  private processingStats = {
    totalProcessed: 0,
    averageProcessingTime: 0,
    averageConfidence: 0,
    errorCount: 0
  };

  // Aviation-specific vocabulary for enhanced transcription
  private aviationTerms = new Map([
    ['niner', '9'],
    ['tree', '3'],
    ['fife', '5'],
    ['decimal', '.'],
    ['point', '.'],
    ['roger', 'roger'],
    ['wilco', 'wilco'],
    ['negative', 'negative'],
    ['affirmative', 'affirmative'],
    ['say again', 'say again'],
    ['standby', 'standby']
  ]);

  constructor(
    openAIService: OpenAIService,
    logger: ILogger,
    config: IConfigService,
    eventEmitter: EventEmitter
  ) {
    this.openAIService = openAIService;
    this.logger = logger;
    this.config = config;
    this.eventEmitter = eventEmitter;
  }

  async initialize(): Promise<void> {
    await this.openAIService.initialize();
    this.startProcessingQueue();
    this.logger.info('Speech-to-Text service initialized');
  }

  async shutdown(): Promise<void> {
    this.isProcessing = false;
    
    // Wait for current processing to complete
    while (this.audioQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    await this.openAIService.shutdown();
    this.logger.info('Speech-to-Text service shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    return await this.openAIService.isHealthy();
  }

  // Process audio chunk for transcription
  async processAudioChunk(audioChunk: AudioChunk): Promise<TranscriptionResult> {
    const startTime = Date.now();
    
    try {
      // Validate audio data
      if (!audioChunk.audioData || audioChunk.audioData.length === 0) {
        throw new Error('Invalid audio data provided');
      }

      // Analyze audio quality
      const audioQuality = this.analyzeAudioQuality(audioChunk.audioData);
      
      // Check if audio quality is sufficient for transcription
      if (audioQuality.signalToNoiseRatio < 0.3) {
        this.logger.warn('Low audio quality detected', {
          chunkId: audioChunk.id,
          snr: audioQuality.signalToNoiseRatio
        });
      }

      // Preprocess audio if needed
      const processedAudio = await this.preprocessAudio(audioChunk.audioData);

      // Transcribe using OpenAI Whisper
      const transcriptionResult = await this.openAIService.transcribeAudio(
        processedAudio,
        audioChunk.frequency
      );

      // Post-process transcription for aviation terminology
      const enhancedTranscription = this.enhanceAviationTranscription(
        transcriptionResult.transcription
      );

      // Calculate final confidence based on audio quality and transcription confidence
      const finalConfidence = this.calculateFinalConfidence(
        transcriptionResult.confidence,
        audioQuality
      );

      const processingTime = Date.now() - startTime;
      
      const result: TranscriptionResult = {
        id: audioChunk.id,
        transcription: enhancedTranscription,
        confidence: finalConfidence,
        processingTime,
        audioQuality
      };

      // Update processing statistics
      this.updateProcessingStats(result);

      // Emit transcription completed event
      this.eventEmitter.emit('transcription:completed', {
        chunkId: audioChunk.id,
        transcription: enhancedTranscription,
        confidence: finalConfidence,
        frequency: audioChunk.frequency
      });

      this.logger.info('Audio transcription completed', {
        chunkId: audioChunk.id,
        transcriptionLength: enhancedTranscription.length,
        confidence: finalConfidence,
        processingTime,
        frequency: audioChunk.frequency
      });

      return result;
    } catch (error) {
      this.processingStats.errorCount++;
      this.logger.error('Audio transcription failed', error as Error, {
        chunkId: audioChunk.id,
        frequency: audioChunk.frequency
      });

      // Emit transcription error event
      this.eventEmitter.emit('transcription:error', {
        chunkId: audioChunk.id,
        error: (error as Error).message,
        frequency: audioChunk.frequency
      });

      throw error;
    }
  }

  // Queue audio chunk for processing
  queueAudioChunk(audioChunk: AudioChunk): void {
    this.audioQueue.push(audioChunk);
    this.logger.debug('Audio chunk queued for processing', {
      chunkId: audioChunk.id,
      queueLength: this.audioQueue.length
    });
  }

  // Process audio in real-time streaming mode
  async processAudioStream(
    audioStream: AsyncIterable<Buffer>,
    frequency: string,
    onTranscription: (result: TranscriptionResult) => void
  ): Promise<void> {
    let chunkCounter = 0;
    const chunkSize = 1024 * 1024; // 1MB chunks
    let audioBuffer = Buffer.alloc(0);

    try {
      for await (const chunk of audioStream) {
        audioBuffer = Buffer.concat([audioBuffer, chunk]);

        // Process when we have enough audio data (approximately 1-2 seconds)
        if (audioBuffer.length >= chunkSize) {
          const audioChunk: AudioChunk = {
            id: `stream-${Date.now()}-${chunkCounter++}`,
            audioData: audioBuffer,
            frequency,
            timestamp: new Date(),
            duration: this.estimateAudioDuration(audioBuffer)
          };

          // Process asynchronously
          this.processAudioChunk(audioChunk)
            .then(onTranscription)
            .catch(error => {
              this.logger.error('Stream transcription failed', error);
            });

          // Reset buffer
          audioBuffer = Buffer.alloc(0);
        }
      }

      // Process remaining audio
      if (audioBuffer.length > 0) {
        const audioChunk: AudioChunk = {
          id: `stream-final-${Date.now()}`,
          audioData: audioBuffer,
          frequency,
          timestamp: new Date(),
          duration: this.estimateAudioDuration(audioBuffer)
        };

        const result = await this.processAudioChunk(audioChunk);
        onTranscription(result);
      }
    } catch (error) {
      this.logger.error('Audio stream processing failed', error as Error);
      throw error;
    }
  }

  // Get processing statistics
  getProcessingStats(): typeof this.processingStats {
    return { ...this.processingStats };
  }

  // Private helper methods
  private startProcessingQueue(): void {
    this.isProcessing = true;
    
    const processQueue = async () => {
      while (this.isProcessing) {
        if (this.audioQueue.length > 0) {
          const audioChunk = this.audioQueue.shift()!;
          
          try {
            await this.processAudioChunk(audioChunk);
          } catch (error) {
            this.logger.error('Queue processing error', error as Error);
          }
        } else {
          // Wait before checking queue again
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    };

    processQueue().catch(error => {
      this.logger.error('Queue processing failed', error);
    });
  }

  private analyzeAudioQuality(audioData: Buffer): AudioQualityMetrics {
    // Simple audio quality analysis
    // In a real implementation, this would use proper audio analysis libraries
    
    const samples = new Int16Array(audioData.buffer);
    let sum = 0;
    let sumSquares = 0;
    let maxAmplitude = 0;
    let clippingCount = 0;

    for (let i = 0; i < samples.length; i++) {
      const sample = Math.abs(samples[i]);
      sum += sample;
      sumSquares += sample * sample;
      maxAmplitude = Math.max(maxAmplitude, sample);
      
      // Check for clipping (values near maximum)
      if (sample > 30000) {
        clippingCount++;
      }
    }

    const mean = sum / samples.length;
    const variance = (sumSquares / samples.length) - (mean * mean);
    const standardDeviation = Math.sqrt(variance);
    
    // Calculate signal-to-noise ratio (simplified)
    const signalToNoiseRatio = mean > 0 ? standardDeviation / mean : 0;
    
    // Calculate clarity based on dynamic range
    const clarity = maxAmplitude > 0 ? (maxAmplitude - mean) / maxAmplitude : 0;
    
    // Calculate volume level
    const volume = mean / 32768; // Normalize to 0-1 range
    
    // Check for clipping
    const hasClipping = (clippingCount / samples.length) > 0.01; // More than 1% clipped

    return {
      signalToNoiseRatio: Math.min(1, Math.max(0, signalToNoiseRatio)),
      clarity: Math.min(1, Math.max(0, clarity)),
      volume: Math.min(1, Math.max(0, volume)),
      hasClipping
    };
  }

  private async preprocessAudio(audioData: Buffer): Promise<Buffer> {
    // Basic audio preprocessing
    // In a real implementation, this might include noise reduction, normalization, etc.
    
    // For now, just return the original data
    // Future enhancements could include:
    // - Noise reduction
    // - Volume normalization
    // - Format conversion
    // - Filtering
    
    return audioData;
  }

  private enhanceAviationTranscription(transcription: string): string {
    let enhanced = transcription;
    
    // Replace aviation phonetic numbers and terms
    for (const [phonetic, standard] of this.aviationTerms) {
      const regex = new RegExp(`\\b${phonetic}\\b`, 'gi');
      enhanced = enhanced.replace(regex, standard);
    }

    // Clean up common transcription issues
    enhanced = enhanced
      .replace(/\s+/g, ' ') // Multiple spaces to single space
      .replace(/[.,]{2,}/g, '.') // Multiple punctuation
      .trim();

    // Capitalize proper aviation terms
    const aviationKeywords = [
      'runway', 'taxiway', 'tower', 'ground', 'approach', 'departure',
      'clearance', 'roger', 'wilco', 'negative', 'affirmative'
    ];

    for (const keyword of aviationKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      enhanced = enhanced.replace(regex, keyword.toLowerCase());
    }

    return enhanced;
  }

  private calculateFinalConfidence(
    transcriptionConfidence: number,
    audioQuality: AudioQualityMetrics
  ): number {
    let confidence = transcriptionConfidence;
    
    // Adjust based on audio quality factors
    confidence *= (0.7 + 0.3 * audioQuality.signalToNoiseRatio);
    confidence *= (0.8 + 0.2 * audioQuality.clarity);
    confidence *= (0.9 + 0.1 * audioQuality.volume);
    
    // Penalize for clipping
    if (audioQuality.hasClipping) {
      confidence *= 0.9;
    }

    return Math.min(0.99, Math.max(0.01, confidence));
  }

  private updateProcessingStats(result: TranscriptionResult): void {
    this.processingStats.totalProcessed++;
    
    // Update running averages
    const count = this.processingStats.totalProcessed;
    this.processingStats.averageProcessingTime = 
      ((this.processingStats.averageProcessingTime * (count - 1)) + result.processingTime) / count;
    
    this.processingStats.averageConfidence = 
      ((this.processingStats.averageConfidence * (count - 1)) + result.confidence) / count;
  }

  private estimateAudioDuration(audioData: Buffer): number {
    // Estimate duration based on buffer size
    // Assuming 16-bit, 16kHz mono audio
    const bytesPerSecond = 16000 * 2; // 16kHz * 2 bytes per sample
    return (audioData.length / bytesPerSecond) * 1000; // Return in milliseconds
  }
}