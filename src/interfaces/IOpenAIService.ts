import { IService } from './IService';
import { RadioTransmission, ComplianceResult, ResolutionOption } from '../types';

export interface IOpenAIService extends IService {
  // Speech-to-text functionality
  transcribeAudio(audioBuffer: Buffer, frequency?: string): Promise<{
    transcription: string;
    confidence: number;
  }>;

  // Natural language processing
  checkPhraseologyCompliance(transcription: string): Promise<ComplianceResult>;
  
  // Decision support
  generateConflictResolutions(
    conflictDescription: string,
    aircraftData: any[]
  ): Promise<ResolutionOption[]>;

  // Context management
  updateContext(context: string): void;
  getContext(): string;
}