import { IRadioInterface } from '../interfaces/IDataIngestionService';
import { ILogger, IConfigService } from '../interfaces/IService';
import { RadioTransmission } from '../types';
import { EventEmitter } from '../core/EventEmitter';
import { AudioProcessor } from './AudioProcessor';

export interface RadioChannel {
  frequency: string;
  name: string;
  isActive: boolean;
  signalStrength: number;
  noiseLevel: number;
  lastActivity: Date;
  transmissionCount: number;
}

export interface SDRDevice {
  id: string;
  name: string;
  type: SDRType;
  isConnected: boolean;
  sampleRate: number;
  centerFrequency: number;
  gain: number;
  lastHeartbeat: Date;
}

export enum SDRType {
  RTL_SDR = 'RTL_SDR',
  HACKRF = 'HACKRF',
  AIRSPY = 'AIRSPY',
  USRP = 'USRP',
  SIMULATED = 'SIMULATED'
}

export interface FrequencyBand {
  name: string;
  startFreq: number;
  endFreq: number;
  channelSpacing: number;
  modulation: ModulationType;
}

export enum ModulationType {
  AM = 'AM',
  FM = 'FM',
  USB = 'USB',
  LSB = 'LSB'
}

export class RadioInterface implements IRadioInterface {
  private logger: ILogger;
  private config: IConfigService;
  private eventEmitter: EventEmitter;
  private audioProcessor: AudioProcessor;
  private isListening = false;
  private activeChannels = new Map<string, RadioChannel>();
  private sdrDevices = new Map<string, SDRDevice>();
  private transmissionCallbacks: Array<(transmission: RadioTransmission) => void> = [];
  private monitoringIntervals = new Map<string, NodeJS.Timer>();

  // ATC frequency bands
  private frequencyBands = new Map<string, FrequencyBand>([
    ['VHF_AIR', {
      name: 'VHF Airband',
      startFreq: 118.0,
      endFreq: 137.0,
      channelSpacing: 0.025, // 25 kHz spacing
      modulation: ModulationType.AM
    }],
    ['UHF_AIR', {
      name: 'UHF Airband',
      startFreq: 225.0,
      endFreq: 400.0,
      channelSpacing: 0.025,
      modulation: ModulationType.AM
    }]
  ]);

  constructor(
    logger: ILogger,
    config: IConfigService,
    eventEmitter: EventEmitter,
    audioProcessor: AudioProcessor
  ) {
    this.logger = logger;
    this.config = config;
    this.eventEmitter = eventEmitter;
    this.audioProcessor = audioProcessor;
    this.initializeSDRDevices();
    this.initializeATCFrequencies();
  }

  async initialize(): Promise<void> {
    await this.audioProcessor.initialize();
    await this.detectAndConnectSDRDevices();
    this.startFrequencyMonitoring();
    this.logger.info('Radio Interface initialized');
  }

  async shutdown(): Promise<void> {
    this.isListening = false;
    
    // Stop all monitoring
    for (const [frequency, interval] of this.monitoringIntervals) {
      clearInterval(interval);
      await this.stopListening(frequency);
    }
    
    this.monitoringIntervals.clear();
    this.activeChannels.clear();
    
    await this.audioProcessor.shutdown();
    this.logger.info('Radio Interface shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    const connectedDevices = Array.from(this.sdrDevices.values()).filter(d => d.isConnected);
    const activeChannels = Array.from(this.activeChannels.values()).filter(c => c.isActive);
    return connectedDevices.length > 0 && activeChannels.length > 0 && this.isListening;
  }

  // Start listening to a specific frequency
  async startListening(frequency: string): Promise<void> {
    try {
      // Validate frequency
      if (!this.isValidATCFrequency(frequency)) {
        throw new Error(`Invalid ATC frequency: ${frequency}`);
      }

      // Check if already listening
      if (this.activeChannels.has(frequency)) {
        this.logger.warn(`Already listening to frequency ${frequency}`);
        return;
      }

      // Find available SDR device
      const sdrDevice = this.getAvailableSDRDevice();
      if (!sdrDevice) {
        throw new Error('No available SDR devices for frequency monitoring');
      }

      // Configure SDR for this frequency
      await this.configureSDRForFrequency(sdrDevice, frequency);

      // Create radio channel
      const channel: RadioChannel = {
        frequency,
        name: this.getFrequencyName(frequency),
        isActive: true,
        signalStrength: 0,
        noiseLevel: 0,
        lastActivity: new Date(),
        transmissionCount: 0
      };

      this.activeChannels.set(frequency, channel);

      // Start audio capture for this frequency
      this.audioProcessor.startAudioCapture(frequency);

      // Set up transmission detection
      this.setupTransmissionDetection(frequency);

      this.logger.info(`Started listening to frequency ${frequency}`, {
        channelName: channel.name,
        sdrDevice: sdrDevice.id
      });

      this.eventEmitter.emit('radio:frequency_started', {
        frequency,
        channel,
        sdrDevice: sdrDevice.id
      });

    } catch (error) {
      this.logger.error(`Failed to start listening to frequency ${frequency}`, error as Error);
      throw error;
    }
  }

  // Stop listening to a specific frequency
  async stopListening(frequency: string): Promise<void> {
    try {
      const channel = this.activeChannels.get(frequency);
      if (!channel) {
        this.logger.warn(`Not listening to frequency ${frequency}`);
        return;
      }

      // Stop audio capture
      this.audioProcessor.stopAudioCapture(frequency);

      // Stop monitoring interval
      const interval = this.monitoringIntervals.get(frequency);
      if (interval) {
        clearInterval(interval);
        this.monitoringIntervals.delete(frequency);
      }

      // Remove from active channels
      this.activeChannels.delete(frequency);

      this.logger.info(`Stopped listening to frequency ${frequency}`, {
        transmissionCount: channel.transmissionCount
      });

      this.eventEmitter.emit('radio:frequency_stopped', {
        frequency,
        finalStats: {
          transmissionCount: channel.transmissionCount,
          lastActivity: channel.lastActivity
        }
      });

    } catch (error) {
      this.logger.error(`Failed to stop listening to frequency ${frequency}`, error as Error);
      throw error;
    }
  }

  // Register callback for transmission events
  onTransmission(callback: (transmission: RadioTransmission) => void): void {
    this.transmissionCallbacks.push(callback);
    this.logger.debug('New transmission callback registered', {
      callbackCount: this.transmissionCallbacks.length
    });
  }

  // Get list of active frequencies
  getActiveFrequencies(): string[] {
    return Array.from(this.activeChannels.keys());
  }

  // Get channel information
  getChannelInfo(frequency: string): RadioChannel | null {
    return this.activeChannels.get(frequency) || null;
  }

  // Get all channel information
  getAllChannels(): RadioChannel[] {
    return Array.from(this.activeChannels.values());
  }

  // Get SDR device information
  getSDRDevices(): SDRDevice[] {
    return Array.from(this.sdrDevices.values());
  }

  // Scan for active frequencies in a range
  async scanFrequencyRange(startFreq: number, endFreq: number, stepSize: number = 0.025): Promise<{
    frequency: string;
    signalStrength: number;
    hasActivity: boolean;
  }[]> {
    const results: Array<{
      frequency: string;
      signalStrength: number;
      hasActivity: boolean;
    }> = [];

    this.logger.info('Starting frequency scan', {
      startFreq,
      endFreq,
      stepSize,
      expectedChannels: Math.ceil((endFreq - startFreq) / stepSize)
    });

    for (let freq = startFreq; freq <= endFreq; freq += stepSize) {
      const frequency = freq.toFixed(3);
      
      try {
        // Quick signal strength check
        const signalStrength = await this.measureSignalStrength(frequency);
        const hasActivity = signalStrength > -80; // dBm threshold
        
        results.push({
          frequency,
          signalStrength,
          hasActivity
        });

        // Brief pause to avoid overwhelming the SDR
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch (error) {
        this.logger.error(`Scan failed for frequency ${frequency}`, error as Error);
      }
    }

    this.logger.info('Frequency scan completed', {
      scannedChannels: results.length,
      activeChannels: results.filter(r => r.hasActivity).length
    });

    return results;
  }

  // Update channel signal metrics
  updateChannelMetrics(frequency: string, signalStrength: number, noiseLevel: number): void {
    const channel = this.activeChannels.get(frequency);
    if (channel) {
      channel.signalStrength = signalStrength;
      channel.noiseLevel = noiseLevel;
      channel.lastActivity = new Date();
    }
  }

  // Private helper methods
  private initializeSDRDevices(): void {
    // Initialize simulated SDR device for development/testing
    this.sdrDevices.set('sim_001', {
      id: 'sim_001',
      name: 'Simulated RTL-SDR',
      type: SDRType.SIMULATED,
      isConnected: true,
      sampleRate: 2048000, // 2.048 MHz
      centerFrequency: 127.5, // MHz
      gain: 20, // dB
      lastHeartbeat: new Date()
    });

    // Add configuration for real SDR devices
    const sdrConfig = this.config.get<any>('sdr') || {};
    
    if (sdrConfig.rtlsdr) {
      this.sdrDevices.set('rtlsdr_001', {
        id: 'rtlsdr_001',
        name: 'RTL-SDR Dongle',
        type: SDRType.RTL_SDR,
        isConnected: false,
        sampleRate: 2048000,
        centerFrequency: 127.5,
        gain: 20,
        lastHeartbeat: new Date()
      });
    }
  }

  private initializeATCFrequencies(): void {
    // EWR specific frequencies from configuration
    const frequencies = this.config.get<string[]>('airport.frequencies');
    
    for (const freq of frequencies) {
      // Pre-validate frequencies but don't start listening yet
      if (this.isValidATCFrequency(freq)) {
        this.logger.debug(`Validated ATC frequency: ${freq}`);
      } else {
        this.logger.warn(`Invalid ATC frequency in configuration: ${freq}`);
      }
    }
  }

  private async detectAndConnectSDRDevices(): Promise<void> {
    // In a real implementation, this would use SDR libraries to detect hardware
    // For now, simulate device detection
    
    for (const [id, device] of this.sdrDevices) {
      if (device.type === SDRType.SIMULATED) {
        device.isConnected = true;
        device.lastHeartbeat = new Date();
        this.logger.info(`Connected to simulated SDR device: ${id}`);
      } else {
        // Attempt to connect to real SDR devices
        try {
          await this.connectToSDRDevice(device);
        } catch (error) {
          this.logger.warn(`Failed to connect to SDR device ${id}`, { error: (error as Error).message });
        }
      }
    }
  }

  private async connectToSDRDevice(device: SDRDevice): Promise<void> {
    // Simulate SDR connection process
    // Real implementation would use libraries like rtl-sdr, hackrf, etc.
    
    this.logger.info(`Attempting to connect to SDR device: ${device.id}`);
    
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // For simulation, randomly succeed or fail
    if (Math.random() > 0.3) {
      device.isConnected = true;
      device.lastHeartbeat = new Date();
      this.logger.info(`Successfully connected to SDR device: ${device.id}`);
    } else {
      throw new Error(`Failed to connect to SDR device: ${device.id}`);
    }
  }

  private async configureSDRForFrequency(device: SDRDevice, frequency: string): Promise<void> {
    const freq = parseFloat(frequency);
    
    // Configure SDR parameters for optimal reception
    device.centerFrequency = freq;
    device.lastHeartbeat = new Date();
    
    this.logger.debug(`Configured SDR ${device.id} for frequency ${frequency}`, {
      centerFreq: device.centerFrequency,
      sampleRate: device.sampleRate,
      gain: device.gain
    });
    
    // In real implementation, this would send commands to SDR hardware
    // For simulation, just update the device configuration
  }

  private setupTransmissionDetection(frequency: string): void {
    // Set up audio processing for transmission detection
    this.eventEmitter.on('audio:data_received', (data) => {
      if (data.frequency === frequency) {
        this.processAudioForTransmission(data);
      }
    });

    // Set up periodic signal monitoring
    const monitoringInterval = setInterval(() => {
      this.monitorFrequencyActivity(frequency);
    }, 1000); // Check every second

    this.monitoringIntervals.set(frequency, monitoringInterval);
  }

  private processAudioForTransmission(audioData: any): void {
    const { frequency, audioData: buffer, metrics } = audioData;
    
    // Detect if this is a transmission (voice activity detection)
    const hasVoiceActivity = this.audioProcessor.detectVoiceActivity(buffer);
    
    if (hasVoiceActivity) {
      // Create transmission record
      const transmission: RadioTransmission = {
        id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        frequency,
        callsign: 'UNKNOWN', // Will be determined by transcription
        controller: 'UNKNOWN',
        audioData: buffer,
        transcription: '', // Will be filled by speech-to-text service
        confidence: 0,
        phraseologyCompliance: {
          isCompliant: false,
          confidence: 0,
          issues: [],
          suggestions: []
        }
      };

      // Update channel statistics
      const channel = this.activeChannels.get(frequency);
      if (channel) {
        channel.transmissionCount++;
        channel.lastActivity = new Date();
        channel.signalStrength = metrics.peakLevel;
        channel.noiseLevel = 1 - metrics.rmsLevel; // Simplified noise calculation
      }

      // Notify all transmission callbacks
      this.notifyTransmissionCallbacks(transmission);

      // Emit transmission event
      this.eventEmitter.emit('radio:transmission_detected', {
        transmission,
        frequency,
        signalMetrics: metrics
      });

      this.logger.debug('Transmission detected', {
        frequency,
        transmissionId: transmission.id,
        signalStrength: metrics.peakLevel,
        duration: buffer.length / 16000 // Approximate duration in seconds
      });
    }
  }

  private monitorFrequencyActivity(frequency: string): void {
    const channel = this.activeChannels.get(frequency);
    if (!channel) return;

    // Simulate signal strength monitoring
    // In real implementation, this would query the SDR for signal metrics
    const simulatedSignalStrength = -60 + (Math.random() * 40); // -60 to -20 dBm
    const simulatedNoiseLevel = -90 + (Math.random() * 20); // -90 to -70 dBm

    this.updateChannelMetrics(frequency, simulatedSignalStrength, simulatedNoiseLevel);

    // Check for channel health
    const timeSinceActivity = Date.now() - channel.lastActivity.getTime();
    if (timeSinceActivity > 300000) { // 5 minutes without activity
      this.logger.warn(`No activity on frequency ${frequency} for ${timeSinceActivity / 1000} seconds`);
    }
  }

  private async measureSignalStrength(frequency: string): Promise<number> {
    // Simulate signal strength measurement
    // Real implementation would configure SDR and measure signal power
    
    await new Promise(resolve => setTimeout(resolve, 5)); // Simulate measurement time
    
    // Return simulated signal strength in dBm
    return -80 + (Math.random() * 60); // -80 to -20 dBm range
  }

  private isValidATCFrequency(frequency: string): boolean {
    const freq = parseFloat(frequency);
    
    // Check if frequency is in valid ATC bands
    for (const band of this.frequencyBands.values()) {
      if (freq >= band.startFreq && freq <= band.endFreq) {
        // Check if frequency aligns with channel spacing
        const channelNumber = Math.round((freq - band.startFreq) / band.channelSpacing);
        const expectedFreq = band.startFreq + (channelNumber * band.channelSpacing);
        
        return Math.abs(freq - expectedFreq) < 0.001; // 1 kHz tolerance
      }
    }
    
    return false;
  }

  private getFrequencyName(frequency: string): string {
    // Map common ATC frequencies to their names
    const frequencyNames: { [key: string]: string } = {
      '118.850': 'EWR Tower',
      '119.200': 'EWR Ground',
      '121.900': 'EWR Approach',
      '124.700': 'N90 TRACON',
      '121.500': 'Emergency',
      '122.800': 'Unicom'
    };
    
    return frequencyNames[frequency] || `ATC ${frequency}`;
  }

  private getAvailableSDRDevice(): SDRDevice | null {
    // Find first connected SDR device
    for (const device of this.sdrDevices.values()) {
      if (device.isConnected) {
        return device;
      }
    }
    return null;
  }

  private startFrequencyMonitoring(): void {
    this.isListening = true;
    
    // Start monitoring SDR device health
    setInterval(() => {
      this.monitorSDRDeviceHealth();
    }, 30000); // Check every 30 seconds
  }

  private monitorSDRDeviceHealth(): void {
    const now = new Date();
    
    for (const [id, device] of this.sdrDevices) {
      if (device.isConnected) {
        const timeSinceHeartbeat = now.getTime() - device.lastHeartbeat.getTime();
        
        if (timeSinceHeartbeat > 60000) { // 1 minute timeout
          device.isConnected = false;
          this.logger.warn(`SDR device ${id} appears disconnected`, {
            lastHeartbeat: device.lastHeartbeat,
            timeSinceHeartbeat: timeSinceHeartbeat / 1000
          });
          
          this.eventEmitter.emit('radio:sdr_disconnected', { device });
        } else {
          // Update heartbeat for connected devices
          device.lastHeartbeat = now;
        }
      }
    }
  }

  private notifyTransmissionCallbacks(transmission: RadioTransmission): void {
    for (const callback of this.transmissionCallbacks) {
      try {
        callback(transmission);
      } catch (error) {
        this.logger.error('Transmission callback failed', error as Error);
      }
    }
  }
}