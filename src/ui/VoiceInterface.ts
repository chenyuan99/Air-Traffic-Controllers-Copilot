import { IService, ILogger, IConfigService } from '../interfaces/IService';
import { EventEmitter } from '../core/EventEmitter';
import { Alert, Aircraft, FlightStrip } from '../types';

export interface VoiceCommand {
  id: string;
  phrase: string;
  patterns: string[];
  action: VoiceAction;
  parameters?: VoiceParameter[];
  confidence: number;
  context?: string[];
  requiresConfirmation?: boolean;
}

export interface VoiceAction {
  type: ActionType;
  target?: string;
  data?: any;
  callback?: (result: any) => void;
}

export enum ActionType {
  ACKNOWLEDGE_ALERT = 'ACKNOWLEDGE_ALERT',
  SHOW_PANEL = 'SHOW_PANEL',
  HIDE_PANEL = 'HIDE_PANEL',
  UPDATE_FLIGHT_STRIP = 'UPDATE_FLIGHT_STRIP',
  QUERY_AIRCRAFT = 'QUERY_AIRCRAFT',
  QUERY_WEATHER = 'QUERY_WEATHER',
  SYSTEM_STATUS = 'SYSTEM_STATUS',
  NAVIGATION = 'NAVIGATION',
  CUSTOM_COMMAND = 'CUSTOM_COMMAND'
}

export interface VoiceParameter {
  name: string;
  type: 'string' | 'number' | 'callsign' | 'altitude' | 'heading' | 'frequency';
  required: boolean;
  pattern?: RegExp;
  validation?: (value: any) => boolean;
}

export interface VoiceResponse {
  text: string;
  type: ResponseType;
  data?: any;
  requiresAction?: boolean;
  actionTimeout?: number;
}

export enum ResponseType {
  CONFIRMATION = 'CONFIRMATION',
  INFORMATION = 'INFORMATION',
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  SUCCESS = 'SUCCESS',
  QUESTION = 'QUESTION'
}

export interface SpeechRecognitionConfig {
  language: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  noiseThreshold: number;
  confidenceThreshold: number;
  timeoutMs: number;
}

export interface VoiceSettings {
  enabled: boolean;
  wakeWord: string;
  confirmationRequired: boolean;
  voiceSpeed: number;
  voicePitch: number;
  voiceVolume: number;
  selectedVoice: string;
  noiseSuppressionEnabled: boolean;
  pushToTalkEnabled: boolean;
  pushToTalkKey: string;
}

export class VoiceInterface implements IService {
  private logger: ILogger;
  private config: IConfigService;
  private eventEmitter: EventEmitter;
  private recognition?: SpeechRecognition;
  private synthesis: SpeechSynthesis;
  private isListening = false;
  private isInitialized = false;
  private voiceCommands = new Map<string, VoiceCommand>();
  private voiceSettings: VoiceSettings;
  private currentContext: string[] = [];
  private pendingConfirmation?: VoiceCommand;
  private audioContext?: AudioContext;
  private noiseGate?: GainNode;

  // Aviation-specific vocabulary
  private aviationVocabulary = new Map([
    // Numbers
    ['zero', '0'], ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'],
    ['five', '5'], ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'],
    ['niner', '9'], ['tree', '3'], ['fife', '5'],
    
    // Altitudes
    ['flight level', 'FL'], ['thousand', '000'], ['hundred', '00'],
    
    // Directions
    ['left', 'L'], ['right', 'R'], ['center', 'C'],
    
    // Common phrases
    ['roger', 'acknowledged'], ['wilco', 'will comply'], ['negative', 'no'],
    ['affirmative', 'yes'], ['say again', 'repeat'], ['standby', 'wait']
  ]);

  constructor(
    logger: ILogger,
    config: IConfigService,
    eventEmitter: EventEmitter
  ) {
    this.logger = logger;
    this.config = config;
    this.eventEmitter = eventEmitter;
    this.synthesis = window.speechSynthesis;
    
    this.voiceSettings = this.loadDefaultVoiceSettings();
    this.initializeVoiceCommands();
  }

  async initialize(): Promise<void> {
    try {
      // Check for speech recognition support
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        throw new Error('Speech recognition not supported in this browser');
      }

      // Initialize speech recognition
      await this.initializeSpeechRecognition();
      
      // Initialize audio context for noise suppression
      await this.initializeAudioProcessing();
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Load user voice settings
      await this.loadVoiceSettings();
      
      this.isInitialized = true;
      this.logger.info('Voice Interface initialized successfully');
      
      // Announce system ready
      if (this.voiceSettings.enabled) {
        this.speak('Voice interface ready', ResponseType.INFORMATION);
      }
    } catch (error) {
      this.logger.error('Voice Interface initialization failed', error as Error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.isInitialized = false;
    
    if (this.isListening) {
      this.stopListening();
    }
    
    if (this.audioContext) {
      await this.audioContext.close();
    }
    
    this.voiceCommands.clear();
    this.logger.info('Voice Interface shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    return this.isInitialized && this.recognition !== undefined;
  }

  // Start voice recognition
  startListening(): void {
    if (!this.isInitialized || !this.voiceSettings.enabled || this.isListening) {
      return;
    }

    try {
      if (this.recognition) {
        this.recognition.start();
        this.isListening = true;
        
        this.logger.info('Voice recognition started');
        this.eventEmitter.emit('voice:listening_started');
      }
    } catch (error) {
      this.logger.error('Failed to start voice recognition', error as Error);
    }
  }

  // Stop voice recognition
  stopListening(): void {
    if (!this.isListening || !this.recognition) {
      return;
    }

    try {
      this.recognition.stop();
      this.isListening = false;
      
      this.logger.info('Voice recognition stopped');
      this.eventEmitter.emit('voice:listening_stopped');
    } catch (error) {
      this.logger.error('Failed to stop voice recognition', error as Error);
    }
  }

  // Toggle listening state
  toggleListening(): void {
    if (this.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  // Speak text using text-to-speech
  speak(text: string, type: ResponseType = ResponseType.INFORMATION): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.voiceSettings.enabled) {
        resolve();
        return;
      }

      try {
        // Cancel any ongoing speech
        this.synthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        
        // Configure voice settings
        utterance.rate = this.voiceSettings.voiceSpeed;
        utterance.pitch = this.voiceSettings.voicePitch;
        utterance.volume = this.voiceSettings.voiceVolume;
        
        // Set voice if specified
        const voices = this.synthesis.getVoices();
        const selectedVoice = voices.find(voice => voice.name === this.voiceSettings.selectedVoice);
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }

        // Adjust speech based on response type
        switch (type) {
          case ResponseType.ERROR:
            utterance.pitch = Math.max(0.1, this.voiceSettings.voicePitch - 0.2);
            utterance.rate = Math.max(0.1, this.voiceSettings.voiceSpeed - 0.2);
            break;
          case ResponseType.WARNING:
            utterance.pitch = Math.min(2.0, this.voiceSettings.voicePitch + 0.1);
            break;
          case ResponseType.CONFIRMATION:
            utterance.rate = Math.max(0.1, this.voiceSettings.voiceSpeed - 0.1);
            break;
        }

        utterance.onend = () => {
          this.logger.debug('Speech synthesis completed', { text, type });
          resolve();
        };

        utterance.onerror = (event) => {
          this.logger.error('Speech synthesis failed', new Error(event.error));
          reject(new Error(event.error));
        };

        this.synthesis.speak(utterance);
        
        this.eventEmitter.emit('voice:speech_started', { text, type });
      } catch (error) {
        this.logger.error('Failed to speak text', error as Error);
        reject(error);
      }
    });
  }

  // Process voice command
  async processVoiceCommand(transcript: string, confidence: number): Promise<VoiceResponse> {
    try {
      // Normalize transcript for aviation terminology
      const normalizedTranscript = this.normalizeAviationTerms(transcript.toLowerCase());
      
      this.logger.info('Processing voice command', {
        original: transcript,
        normalized: normalizedTranscript,
        confidence
      });

      // Check confidence threshold
      if (confidence < this.voiceSettings.confirmationRequired ? 0.8 : 0.6) {
        return {
          text: 'I didn\'t understand that clearly. Please repeat.',
          type: ResponseType.ERROR
        };
      }

      // Handle pending confirmation
      if (this.pendingConfirmation) {
        return this.handleConfirmation(normalizedTranscript);
      }

      // Find matching command
      const matchedCommand = this.findMatchingCommand(normalizedTranscript);
      
      if (!matchedCommand) {
        return {
          text: 'Command not recognized. Say "help" for available commands.',
          type: ResponseType.ERROR
        };
      }

      // Execute command
      return await this.executeCommand(matchedCommand, normalizedTranscript);
    } catch (error) {
      this.logger.error('Voice command processing failed', error as Error);
      return {
        text: 'An error occurred processing your command.',
        type: ResponseType.ERROR
      };
    }
  }

  // Add custom voice command
  addVoiceCommand(command: VoiceCommand): void {
    this.voiceCommands.set(command.id, command);
    this.logger.info('Added voice command', { id: command.id, phrase: command.phrase });
  }

  // Remove voice command
  removeVoiceCommand(commandId: string): void {
    this.voiceCommands.delete(commandId);
    this.logger.info('Removed voice command', { id: commandId });
  }

  // Update voice settings
  updateVoiceSettings(settings: Partial<VoiceSettings>): void {
    this.voiceSettings = { ...this.voiceSettings, ...settings };
    this.saveVoiceSettings();
    
    this.eventEmitter.emit('voice:settings_updated', { settings: this.voiceSettings });
  }

  // Get available voices
  getAvailableVoices(): SpeechSynthesisVoice[] {
    return this.synthesis.getVoices();
  }

  // Set context for command interpretation
  setContext(context: string[]): void {
    this.currentContext = context;
    this.logger.debug('Voice context updated', { context });
  }

  // Get current voice settings
  getVoiceSettings(): VoiceSettings {
    return { ...this.voiceSettings };
  }

  // Private helper methods
  private async initializeSpeechRecognition(): Promise<void> {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();

    const config: SpeechRecognitionConfig = {
      language: 'en-US',
      continuous: true,
      interimResults: true,
      maxAlternatives: 3,
      noiseThreshold: 0.1,
      confidenceThreshold: 0.6,
      timeoutMs: 5000
    };

    this.recognition.lang = config.language;
    this.recognition.continuous = config.continuous;
    this.recognition.interimResults = config.interimResults;
    this.recognition.maxAlternatives = config.maxAlternatives;

    // Set up event handlers
    this.recognition.onstart = () => {
      this.logger.debug('Speech recognition started');
    };

    this.recognition.onresult = (event) => {
      this.handleSpeechResult(event);
    };

    this.recognition.onerror = (event) => {
      this.handleSpeechError(event);
    };

    this.recognition.onend = () => {
      this.handleSpeechEnd();
    };
  }

  private async initializeAudioProcessing(): Promise<void> {
    if (this.voiceSettings.noiseSuppressionEnabled) {
      try {
        this.audioContext = new AudioContext();
        this.noiseGate = this.audioContext.createGain();
        
        // Set up noise gate
        this.noiseGate.gain.value = 0.1;
        
        this.logger.debug('Audio processing initialized');
      } catch (error) {
        this.logger.warn('Failed to initialize audio processing', { error: (error as Error).message });
      }
    }
  }

  private setupEventListeners(): void {
    // Push-to-talk functionality
    if (this.voiceSettings.pushToTalkEnabled) {
      document.addEventListener('keydown', (event) => {
        if (event.code === this.voiceSettings.pushToTalkKey && !this.isListening) {
          event.preventDefault();
          this.startListening();
        }
      });

      document.addEventListener('keyup', (event) => {
        if (event.code === this.voiceSettings.pushToTalkKey && this.isListening) {
          event.preventDefault();
          this.stopListening();
        }
      });
    }

    // Wake word detection
    this.eventEmitter.on('voice:wake_word_detected', () => {
      if (!this.isListening) {
        this.startListening();
      }
    });
  }

  private handleSpeechResult(event: SpeechRecognitionEvent): void {
    let finalTranscript = '';
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      const confidence = result[0].confidence;

      if (result.isFinal) {
        finalTranscript += transcript;
        
        // Process the final result
        this.processVoiceCommand(transcript, confidence)
          .then(response => {
            this.handleVoiceResponse(response);
          })
          .catch(error => {
            this.logger.error('Voice command processing error', error);
          });
      } else {
        interimTranscript += transcript;
      }
    }

    // Emit interim results for UI feedback
    if (interimTranscript) {
      this.eventEmitter.emit('voice:interim_result', { transcript: interimTranscript });
    }
  }

  private handleSpeechError(event: SpeechRecognitionErrorEvent): void {
    this.logger.error('Speech recognition error', new Error(event.error));
    
    let errorMessage = 'Speech recognition error';
    
    switch (event.error) {
      case 'no-speech':
        errorMessage = 'No speech detected';
        break;
      case 'audio-capture':
        errorMessage = 'Audio capture failed';
        break;
      case 'not-allowed':
        errorMessage = 'Microphone access denied';
        break;
      case 'network':
        errorMessage = 'Network error during recognition';
        break;
    }

    this.eventEmitter.emit('voice:error', { error: event.error, message: errorMessage });
  }

  private handleSpeechEnd(): void {
    this.isListening = false;
    
    // Auto-restart if continuous mode is enabled and not manually stopped
    if (this.voiceSettings.enabled && !this.voiceSettings.pushToTalkEnabled) {
      setTimeout(() => {
        if (this.isInitialized && this.voiceSettings.enabled) {
          this.startListening();
        }
      }, 1000);
    }
  }

  private normalizeAviationTerms(transcript: string): string {
    let normalized = transcript;
    
    // Replace aviation-specific terms
    for (const [spoken, written] of this.aviationVocabulary) {
      const regex = new RegExp(`\\b${spoken}\\b`, 'gi');
      normalized = normalized.replace(regex, written);
    }
    
    // Normalize callsigns (e.g., "united one two three" -> "UAL123")
    normalized = this.normalizeCallsigns(normalized);
    
    // Normalize altitudes (e.g., "flight level two five zero" -> "FL250")
    normalized = this.normalizeAltitudes(normalized);
    
    return normalized;
  }

  private normalizeCallsigns(text: string): string {
    // Simplified callsign normalization
    // Real implementation would have comprehensive airline code mapping
    const airlineMap = new Map([
      ['united', 'UAL'], ['delta', 'DAL'], ['american', 'AAL'],
      ['southwest', 'SWA'], ['jetblue', 'JBU'], ['alaska', 'ASA']
    ]);
    
    let normalized = text;
    
    for (const [airline, code] of airlineMap) {
      const pattern = new RegExp(`\\b${airline}\\s+(\\w+\\s*\\w*\\s*\\w*)`, 'gi');
      normalized = normalized.replace(pattern, (match, numbers) => {
        const digits = numbers.replace(/\s+/g, '').replace(/\D/g, '');
        return `${code}${digits}`;
      });
    }
    
    return normalized;
  }

  private normalizeAltitudes(text: string): string {
    // Convert spoken altitudes to standard format
    let normalized = text;
    
    // Flight levels
    const flPattern = /flight level (\w+\s*\w*\s*\w*)/gi;
    normalized = normalized.replace(flPattern, (match, level) => {
      const digits = level.replace(/\s+/g, '').replace(/\D/g, '');
      return `FL${digits}`;
    });
    
    // Thousands
    const thousandPattern = /(\d+)\s*thousand/gi;
    normalized = normalized.replace(thousandPattern, '$1000');
    
    return normalized;
  }

  private findMatchingCommand(transcript: string): VoiceCommand | null {
    let bestMatch: VoiceCommand | null = null;
    let bestScore = 0;

    for (const command of this.voiceCommands.values()) {
      // Check if command is valid in current context
      if (command.context && !command.context.some(ctx => this.currentContext.includes(ctx))) {
        continue;
      }

      // Check each pattern
      for (const pattern of command.patterns) {
        const score = this.calculateMatchScore(transcript, pattern);
        if (score > bestScore && score >= 0.7) {
          bestMatch = command;
          bestScore = score;
        }
      }
    }

    return bestMatch;
  }

  private calculateMatchScore(transcript: string, pattern: string): number {
    // Simplified pattern matching - real implementation would use more sophisticated NLP
    const transcriptWords = transcript.toLowerCase().split(/\s+/);
    const patternWords = pattern.toLowerCase().split(/\s+/);
    
    let matches = 0;
    let totalWords = patternWords.length;
    
    for (const patternWord of patternWords) {
      if (patternWord.startsWith('*') || transcriptWords.includes(patternWord)) {
        matches++;
      }
    }
    
    return matches / totalWords;
  }

  private async executeCommand(command: VoiceCommand, transcript: string): Promise<VoiceResponse> {
    try {
      // Check if confirmation is required
      if (command.requiresConfirmation && !this.pendingConfirmation) {
        this.pendingConfirmation = command;
        return {
          text: `Confirm: ${command.phrase}?`,
          type: ResponseType.QUESTION,
          requiresAction: true,
          actionTimeout: 10000
        };
      }

      // Extract parameters if needed
      const parameters = this.extractParameters(command, transcript);
      
      // Execute the command action
      const result = await this.performAction(command.action, parameters);
      
      this.logger.info('Voice command executed', {
        commandId: command.id,
        action: command.action.type,
        parameters
      });

      this.eventEmitter.emit('voice:command_executed', {
        command,
        parameters,
        result
      });

      return result;
    } catch (error) {
      this.logger.error('Command execution failed', error as Error);
      return {
        text: 'Failed to execute command.',
        type: ResponseType.ERROR
      };
    }
  }

  private handleConfirmation(transcript: string): VoiceResponse {
    const isConfirmed = /^(yes|affirmative|confirm|roger|correct)$/i.test(transcript.trim());
    const isDenied = /^(no|negative|cancel|abort)$/i.test(transcript.trim());
    
    if (isConfirmed && this.pendingConfirmation) {
      const command = this.pendingConfirmation;
      this.pendingConfirmation = undefined;
      
      return this.performAction(command.action, {});
    } else if (isDenied) {
      this.pendingConfirmation = undefined;
      return {
        text: 'Command cancelled.',
        type: ResponseType.INFORMATION
      };
    } else {
      return {
        text: 'Please say yes or no.',
        type: ResponseType.QUESTION
      };
    }
  }

  private extractParameters(command: VoiceCommand, transcript: string): any {
    const parameters: any = {};
    
    if (!command.parameters) {
      return parameters;
    }

    for (const param of command.parameters) {
      const value = this.extractParameterValue(transcript, param);
      if (value !== null) {
        parameters[param.name] = value;
      } else if (param.required) {
        throw new Error(`Required parameter '${param.name}' not found`);
      }
    }
    
    return parameters;
  }

  private extractParameterValue(transcript: string, param: VoiceParameter): any {
    if (param.pattern) {
      const match = transcript.match(param.pattern);
      if (match) {
        return this.convertParameterType(match[1] || match[0], param.type);
      }
    }
    
    // Fallback extraction based on parameter type
    switch (param.type) {
      case 'callsign':
        return this.extractCallsign(transcript);
      case 'altitude':
        return this.extractAltitude(transcript);
      case 'heading':
        return this.extractHeading(transcript);
      case 'frequency':
        return this.extractFrequency(transcript);
      default:
        return null;
    }
  }

  private convertParameterType(value: string, type: VoiceParameter['type']): any {
    switch (type) {
      case 'number':
        return parseFloat(value);
      case 'altitude':
        return parseInt(value.replace(/\D/g, ''));
      case 'heading':
        return parseInt(value.replace(/\D/g, ''));
      default:
        return value;
    }
  }

  private extractCallsign(transcript: string): string | null {
    // Look for airline codes followed by numbers
    const match = transcript.match(/\b([A-Z]{3}\d+)\b/i);
    return match ? match[1].toUpperCase() : null;
  }

  private extractAltitude(transcript: string): number | null {
    // Look for altitude patterns
    const flMatch = transcript.match(/FL(\d+)/i);
    if (flMatch) {
      return parseInt(flMatch[1]) * 100;
    }
    
    const altMatch = transcript.match(/(\d+)(?:\s*(?:feet|ft))?/i);
    if (altMatch) {
      return parseInt(altMatch[1]);
    }
    
    return null;
  }

  private extractHeading(transcript: string): number | null {
    const match = transcript.match(/(\d{1,3})(?:\s*degrees?)?/i);
    if (match) {
      const heading = parseInt(match[1]);
      return heading >= 0 && heading <= 360 ? heading : null;
    }
    return null;
  }

  private extractFrequency(transcript: string): string | null {
    const match = transcript.match(/(\d{3}\.\d{1,3})/);
    return match ? match[1] : null;
  }

  private async performAction(action: VoiceAction, parameters: any): Promise<VoiceResponse> {
    switch (action.type) {
      case ActionType.ACKNOWLEDGE_ALERT:
        this.eventEmitter.emit('voice:acknowledge_alert', parameters);
        return { text: 'Alert acknowledged.', type: ResponseType.CONFIRMATION };
        
      case ActionType.SHOW_PANEL:
        this.eventEmitter.emit('voice:show_panel', { panelType: action.target });
        return { text: `Showing ${action.target} panel.`, type: ResponseType.CONFIRMATION };
        
      case ActionType.HIDE_PANEL:
        this.eventEmitter.emit('voice:hide_panel', { panelType: action.target });
        return { text: `Hiding ${action.target} panel.`, type: ResponseType.CONFIRMATION };
        
      case ActionType.QUERY_AIRCRAFT:
        if (parameters.callsign) {
          this.eventEmitter.emit('voice:query_aircraft', { callsign: parameters.callsign });
          return { text: `Querying aircraft ${parameters.callsign}.`, type: ResponseType.INFORMATION };
        }
        return { text: 'Please specify aircraft callsign.', type: ResponseType.ERROR };
        
      case ActionType.SYSTEM_STATUS:
        this.eventEmitter.emit('voice:system_status');
        return { text: 'System status: All systems operational.', type: ResponseType.INFORMATION };
        
      default:
        return { text: 'Action not implemented.', type: ResponseType.ERROR };
    }
  }

  private handleVoiceResponse(response: VoiceResponse): void {
    // Speak the response
    this.speak(response.text, response.type);
    
    // Emit response event
    this.eventEmitter.emit('voice:response', response);
  }

  private initializeVoiceCommands(): void {
    // System commands
    this.addVoiceCommand({
      id: 'acknowledge_alert',
      phrase: 'acknowledge alert',
      patterns: ['acknowledge alert', 'ack alert', 'roger alert'],
      action: { type: ActionType.ACKNOWLEDGE_ALERT },
      confidence: 0.8
    });

    this.addVoiceCommand({
      id: 'show_aircraft',
      phrase: 'show aircraft',
      patterns: ['show aircraft', 'display aircraft', 'aircraft list'],
      action: { type: ActionType.SHOW_PANEL, target: 'aircraft' },
      confidence: 0.8
    });

    this.addVoiceCommand({
      id: 'show_alerts',
      phrase: 'show alerts',
      patterns: ['show alerts', 'display alerts', 'alert panel'],
      action: { type: ActionType.SHOW_PANEL, target: 'alerts' },
      confidence: 0.8
    });

    this.addVoiceCommand({
      id: 'system_status',
      phrase: 'system status',
      patterns: ['system status', 'status report', 'system check'],
      action: { type: ActionType.SYSTEM_STATUS },
      confidence: 0.8
    });

    this.addVoiceCommand({
      id: 'query_aircraft',
      phrase: 'query aircraft *',
      patterns: ['query aircraft *', 'show aircraft *', 'aircraft * status'],
      action: { type: ActionType.QUERY_AIRCRAFT },
      parameters: [{
        name: 'callsign',
        type: 'callsign',
        required: true,
        pattern: /aircraft\s+([A-Z]{3}\d+)/i
      }],
      confidence: 0.8
    });
  }

  private loadDefaultVoiceSettings(): VoiceSettings {
    return {
      enabled: true,
      wakeWord: 'assistant',
      confirmationRequired: true,
      voiceSpeed: 1.0,
      voicePitch: 1.0,
      voiceVolume: 0.8,
      selectedVoice: '',
      noiseSuppressionEnabled: true,
      pushToTalkEnabled: false,
      pushToTalkKey: 'Space'
    };
  }

  private async loadVoiceSettings(): Promise<void> {
    try {
      const saved = localStorage.getItem('atc_voice_settings');
      if (saved) {
        const settings = JSON.parse(saved);
        this.voiceSettings = { ...this.voiceSettings, ...settings };
      }
    } catch (error) {
      this.logger.warn('Failed to load voice settings', { error: (error as Error).message });
    }
  }

  private saveVoiceSettings(): void {
    try {
      localStorage.setItem('atc_voice_settings', JSON.stringify(this.voiceSettings));
    } catch (error) {
      this.logger.warn('Failed to save voice settings', { error: (error as Error).message });
    }
  }
}