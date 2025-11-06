import { IService, ILogger } from '../interfaces/IService';
import { EventEmitter } from '../core/EventEmitter';

export interface AudioStreamConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  chunkDuration: number; // in milliseconds
}

export interface AudioMetrics {
  peakLevel: number;
  rmsLevel: number;
  frequency: string;
  timestamp: Date;
}

export class AudioProcessor implements IService {
  private logger: ILogger;
  private eventEmitter: EventEmitter;
  private isProcessing = false;
  private activeStreams = new Map<string, NodeJS.Timer>();
  private audioConfig: AudioStreamConfig;

  constructor(logger: ILogger, eventEmitter: EventEmitter) {
    this.logger = logger;
    this.eventEmitter = eventEmitter;
    
    // Default audio configuration for ATC radio
    this.audioConfig = {
      sampleRate: 16000, // 16kHz is sufficient for voice
      channels: 1, // Mono
      bitDepth: 16, // 16-bit
      chunkDuration: 1000 // 1 second chunks
    };
  }

  async initialize(): Promise<void> {
    this.isProcessing = true;
    this.logger.info('Audio processor initialized');
  }

  async shutdown(): Promise<void> {
    this.isProcessing = false;
    
    // Stop all active streams
    for (const [frequency, timer] of this.activeStreams) {
      clearInterval(timer);
      this.logger.info(`Stopped audio stream for frequency ${frequency}`);
    }
    this.activeStreams.clear();
    
    this.logger.info('Audio processor shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    return this.isProcessing;
  }

  // Start capturing audio from a specific frequency
  startAudioCapture(frequency: string): void {
    if (this.activeStreams.has(frequency)) {
      this.logger.warn(`Audio capture already active for frequency ${frequency}`);
      return;
    }

    this.logger.info(`Starting audio capture for frequency ${frequency}`);
    
    // Simulate audio capture (in real implementation, this would interface with SDR)
    const captureInterval = setInterval(() => {
      if (this.isProcessing) {
        this.simulateAudioCapture(frequency);
      }
    }, this.audioConfig.chunkDuration);

    this.activeStreams.set(frequency, captureInterval);
    
    this.eventEmitter.emit('audio:capture_started', { frequency });
  }

  // Stop capturing audio from a specific frequency
  stopAudioCapture(frequency: string): void {
    const timer = this.activeStreams.get(frequency);
    if (timer) {
      clearInterval(timer);
      this.activeStreams.delete(frequency);
      this.logger.info(`Stopped audio capture for frequency ${frequency}`);
      
      this.eventEmitter.emit('audio:capture_stopped', { frequency });
    }
  }

  // Get list of active audio streams
  getActiveStreams(): string[] {
    return Array.from(this.activeStreams.keys());
  }

  // Update audio configuration
  updateAudioConfig(config: Partial<AudioStreamConfig>): void {
    this.audioConfig = { ...this.audioConfig, ...config };
    this.logger.info('Audio configuration updated', { config: this.audioConfig });
  }

  // Process raw audio data and extract chunks
  processRawAudio(
    rawAudio: Buffer,
    frequency: string,
    onChunk: (chunk: Buffer, metrics: AudioMetrics) => void
  ): void {
    try {
      // Calculate chunk size based on configuration
      const bytesPerSample = this.audioConfig.bitDepth / 8;
      const samplesPerChunk = (this.audioConfig.sampleRate * this.audioConfig.chunkDuration) / 1000;
      const chunkSize = samplesPerChunk * bytesPerSample * this.audioConfig.channels;

      let offset = 0;
      while (offset + chunkSize <= rawAudio.length) {
        const chunk = rawAudio.subarray(offset, offset + chunkSize);
        const metrics = this.calculateAudioMetrics(chunk, frequency);
        
        // Only process chunks with sufficient audio level
        if (metrics.rmsLevel > 0.01) { // Threshold to filter out silence
          onChunk(chunk, metrics);
        }
        
        offset += chunkSize;
      }
    } catch (error) {
      this.logger.error('Raw audio processing failed', error as Error, { frequency });
    }
  }

  // Apply audio filters and enhancements
  enhanceAudioForSpeech(audioData: Buffer): Buffer {
    try {
      // Convert to samples for processing
      const samples = new Int16Array(audioData.buffer);
      const enhanced = new Int16Array(samples.length);

      // Apply simple high-pass filter to remove low-frequency noise
      let previousSample = 0;
      const alpha = 0.95; // High-pass filter coefficient

      for (let i = 0; i < samples.length; i++) {
        const currentSample = samples[i];
        enhanced[i] = alpha * (enhanced[i - 1] || 0) + alpha * (currentSample - previousSample);
        previousSample = currentSample;
      }

      // Apply automatic gain control (AGC)
      const maxAmplitude = Math.max(...enhanced.map(Math.abs));
      if (maxAmplitude > 0) {
        const targetAmplitude = 16384; // Target level (50% of max)
        const gainFactor = Math.min(2.0, targetAmplitude / maxAmplitude);
        
        for (let i = 0; i < enhanced.length; i++) {
          enhanced[i] = Math.max(-32768, Math.min(32767, enhanced[i] * gainFactor));
        }
      }

      return Buffer.from(enhanced.buffer);
    } catch (error) {
      this.logger.error('Audio enhancement failed', error as Error);
      return audioData; // Return original if enhancement fails
    }
  }

  // Detect voice activity in audio
  detectVoiceActivity(audioData: Buffer, threshold: number = 0.02): boolean {
    try {
      const samples = new Int16Array(audioData.buffer);
      let energy = 0;
      
      // Calculate RMS energy
      for (let i = 0; i < samples.length; i++) {
        energy += samples[i] * samples[i];
      }
      
      const rmsEnergy = Math.sqrt(energy / samples.length) / 32768;
      return rmsEnergy > threshold;
    } catch (error) {
      this.logger.error('Voice activity detection failed', error as Error);
      return false;
    }
  }

  // Convert audio format if needed
  convertAudioFormat(
    audioData: Buffer,
    fromFormat: AudioStreamConfig,
    toFormat: AudioStreamConfig
  ): Buffer {
    // Simple format conversion (in real implementation, use proper audio libraries)
    if (fromFormat.sampleRate === toFormat.sampleRate &&
        fromFormat.bitDepth === toFormat.bitDepth &&
        fromFormat.channels === toFormat.channels) {
      return audioData; // No conversion needed
    }

    this.logger.warn('Audio format conversion not fully implemented', {
      fromFormat,
      toFormat
    });
    
    // For now, return original data
    // Real implementation would handle:
    // - Sample rate conversion
    // - Bit depth conversion
    // - Channel conversion (mono/stereo)
    return audioData;
  }

  // Private helper methods
  private simulateAudioCapture(frequency: string): void {
    // Simulate audio data capture from SDR
    // In real implementation, this would interface with radio hardware
    
    const chunkSize = (this.audioConfig.sampleRate * this.audioConfig.chunkDuration) / 1000;
    const audioData = this.generateSimulatedAudio(chunkSize);
    
    const metrics = this.calculateAudioMetrics(audioData, frequency);
    
    // Emit audio data event
    this.eventEmitter.emit('audio:data_received', {
      frequency,
      audioData,
      metrics,
      timestamp: new Date()
    });
  }

  private generateSimulatedAudio(sampleCount: number): Buffer {
    // Generate simulated audio data for testing
    const samples = new Int16Array(sampleCount);
    
    // Generate some noise with occasional voice-like patterns
    for (let i = 0; i < sampleCount; i++) {
      // Base noise
      let sample = (Math.random() - 0.5) * 1000;
      
      // Add periodic voice-like patterns (simulate speech)
      if (Math.random() < 0.1) { // 10% chance of voice activity
        const frequency = 200 + Math.random() * 800; // Voice frequency range
        sample += Math.sin(2 * Math.PI * frequency * i / this.audioConfig.sampleRate) * 8000;
      }
      
      samples[i] = Math.max(-32768, Math.min(32767, sample));
    }
    
    return Buffer.from(samples.buffer);
  }

  private calculateAudioMetrics(audioData: Buffer, frequency: string): AudioMetrics {
    const samples = new Int16Array(audioData.buffer);
    
    let peakLevel = 0;
    let sumSquares = 0;
    
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.abs(samples[i]);
      peakLevel = Math.max(peakLevel, sample);
      sumSquares += sample * sample;
    }
    
    const rmsLevel = Math.sqrt(sumSquares / samples.length) / 32768;
    const normalizedPeak = peakLevel / 32768;
    
    return {
      peakLevel: normalizedPeak,
      rmsLevel,
      frequency,
      timestamp: new Date()
    };
  }
}