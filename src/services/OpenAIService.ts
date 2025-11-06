import { IOpenAIService } from '../interfaces/IOpenAIService';
import { ILogger, IConfigService } from '../interfaces/IService';
import { RadioTransmission, ComplianceResult, ResolutionOption } from '../types';
import { OpenAIClient } from './OpenAIClient';

export class OpenAIService implements IOpenAIService {
  private client: OpenAIClient;
  private logger: ILogger;
  private config: IConfigService;
  private context: string = '';
  private aviationVocabulary: string[] = [];

  constructor(logger: ILogger, config: IConfigService) {
    this.logger = logger;
    this.config = config;
    this.client = new OpenAIClient(logger, config);
    this.initializeAviationVocabulary();
  }

  async initialize(): Promise<void> {
    await this.client.initialize();
    this.logger.info('OpenAI Service initialized successfully');
  }

  async shutdown(): Promise<void> {
    await this.client.shutdown();
    this.logger.info('OpenAI Service shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    return await this.client.isHealthy();
  }

  // Speech-to-text using Whisper API
  async transcribeAudio(audioBuffer: Buffer, frequency?: string): Promise<{
    transcription: string;
    confidence: number;
  }> {
    try {
      const startTime = Date.now();
      
      const result = await this.client.executeWithRetry(async () => {
        // Create a File-like object from the buffer
        const audioFile = new File([audioBuffer], 'audio.wav', { type: 'audio/wav' });
        
        const response = await this.client.getClient().audio.transcriptions.create({
          file: audioFile,
          model: this.config.get<string>('openai.whisperModel'),
          language: 'en',
          prompt: this.buildAviationPrompt(frequency),
          response_format: 'verbose_json',
          temperature: 0.1 // Low temperature for consistent transcription
        });

        return response;
      });

      const processingTime = Date.now() - startTime;
      
      // Calculate confidence based on Whisper's internal scoring
      // Whisper doesn't provide confidence directly, so we estimate based on factors
      let confidence = 0.85; // Base confidence
      
      // Adjust confidence based on transcription characteristics
      if (result.text.length < 10) confidence -= 0.1;
      if (result.text.includes('[inaudible]') || result.text.includes('...')) confidence -= 0.2;
      if (this.containsAviationTerms(result.text)) confidence += 0.1;
      
      confidence = Math.max(0.1, Math.min(0.99, confidence));

      this.logger.info('Audio transcription completed', {
        transcriptionLength: result.text.length,
        processingTime,
        confidence,
        frequency
      });

      // Update token count for rate limiting
      this.client.updateTokenCount(Math.ceil(result.text.length / 4));

      return {
        transcription: result.text.trim(),
        confidence
      };
    } catch (error) {
      this.logger.error('Audio transcription failed', error as Error, { frequency });
      throw new Error(`Transcription failed: ${(error as Error).message}`);
    }
  }

  // Check phraseology compliance using GPT-4
  async checkPhraseologyCompliance(transcription: string): Promise<ComplianceResult> {
    try {
      const prompt = this.buildPhraseologyPrompt(transcription);
      
      const result = await this.client.executeWithRetry(async () => {
        const response = await this.client.getClient().chat.completions.create({
          model: this.config.get<string>('openai.model'),
          messages: [
            {
              role: 'system',
              content: 'You are an expert air traffic control phraseology analyzer. Analyze communications for ICAO standard compliance and provide structured feedback.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.2,
          max_tokens: 500,
          functions: [{
            name: 'analyze_phraseology',
            description: 'Analyze ATC phraseology compliance',
            parameters: {
              type: 'object',
              properties: {
                isCompliant: { type: 'boolean' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                issues: { type: 'array', items: { type: 'string' } },
                suggestions: { type: 'array', items: { type: 'string' } }
              },
              required: ['isCompliant', 'confidence', 'issues', 'suggestions']
            }
          }],
          function_call: { name: 'analyze_phraseology' }
        });

        return response;
      });

      // Parse the function call result
      const functionCall = result.choices[0]?.message?.function_call;
      if (!functionCall || !functionCall.arguments) {
        throw new Error('Invalid response format from OpenAI');
      }

      const analysis = JSON.parse(functionCall.arguments) as ComplianceResult;
      
      // Update token count
      this.client.updateTokenCount(result.usage?.total_tokens || 0);

      this.logger.info('Phraseology compliance check completed', {
        isCompliant: analysis.isCompliant,
        confidence: analysis.confidence,
        issueCount: analysis.issues.length
      });

      return analysis;
    } catch (error) {
      this.logger.error('Phraseology compliance check failed', error as Error);
      
      // Return a fallback result
      return {
        isCompliant: false,
        confidence: 0.1,
        issues: ['Analysis failed due to system error'],
        suggestions: ['Manual review required']
      };
    }
  }

  // Generate conflict resolution suggestions
  async generateConflictResolutions(
    conflictDescription: string,
    aircraftData: any[]
  ): Promise<ResolutionOption[]> {
    try {
      const prompt = this.buildConflictResolutionPrompt(conflictDescription, aircraftData);
      
      const result = await this.client.executeWithRetry(async () => {
        const response = await this.client.getClient().chat.completions.create({
          model: this.config.get<string>('openai.model'),
          messages: [
            {
              role: 'system',
              content: 'You are an expert air traffic controller providing conflict resolution suggestions. Always prioritize safety and follow standard ATC procedures.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 800,
          functions: [{
            name: 'generate_resolutions',
            description: 'Generate conflict resolution options',
            parameters: {
              type: 'object',
              properties: {
                resolutions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      description: { type: 'string' },
                      instructions: { type: 'array', items: { type: 'string' } },
                      estimatedResolutionTime: { type: 'number' },
                      confidence: { type: 'number', minimum: 0, maximum: 1 }
                    },
                    required: ['id', 'description', 'instructions', 'estimatedResolutionTime', 'confidence']
                  }
                }
              },
              required: ['resolutions']
            }
          }],
          function_call: { name: 'generate_resolutions' }
        });

        return response;
      });

      // Parse the function call result
      const functionCall = result.choices[0]?.message?.function_call;
      if (!functionCall || !functionCall.arguments) {
        throw new Error('Invalid response format from OpenAI');
      }

      const { resolutions } = JSON.parse(functionCall.arguments);
      
      // Update token count
      this.client.updateTokenCount(result.usage?.total_tokens || 0);

      this.logger.info('Conflict resolution suggestions generated', {
        conflictType: conflictDescription.substring(0, 50),
        resolutionCount: resolutions.length
      });

      return resolutions;
    } catch (error) {
      this.logger.error('Conflict resolution generation failed', error as Error);
      
      // Return fallback resolution
      return [{
        id: 'fallback-001',
        description: 'Manual resolution required',
        instructions: ['Contact supervisor for manual conflict resolution'],
        estimatedResolutionTime: 300, // 5 minutes
        confidence: 0.1
      }];
    }
  }

  // Context management
  updateContext(context: string): void {
    this.context = context;
    this.logger.debug('OpenAI context updated', { contextLength: context.length });
  }

  getContext(): string {
    return this.context;
  }

  // Private helper methods
  private initializeAviationVocabulary(): void {
    this.aviationVocabulary = [
      'runway', 'taxiway', 'approach', 'departure', 'clearance', 'altitude',
      'heading', 'squawk', 'contact', 'frequency', 'tower', 'ground',
      'aircraft', 'flight', 'level', 'climb', 'descend', 'maintain',
      'turn', 'left', 'right', 'direct', 'hold', 'cleared', 'roger',
      'wilco', 'negative', 'affirmative', 'standby', 'say again'
    ];
  }

  private buildAviationPrompt(frequency?: string): string {
    let prompt = 'This is air traffic control radio communication. ';
    if (frequency) {
      prompt += `Frequency: ${frequency}. `;
    }
    prompt += 'Use standard aviation terminology and phraseology. ';
    prompt += 'Common terms: ' + this.aviationVocabulary.join(', ');
    return prompt;
  }

  private buildPhraseologyPrompt(transcription: string): string {
    return `
Analyze this air traffic control communication for ICAO standard phraseology compliance:

"${transcription}"

Check for:
1. Proper use of standard phraseology
2. Clear and unambiguous language
3. Correct sequence of information
4. Appropriate acknowledgments
5. Safety-critical elements

Provide specific issues found and suggestions for improvement.
    `.trim();
  }

  private buildConflictResolutionPrompt(conflictDescription: string, aircraftData: any[]): string {
    return `
Air traffic conflict detected:
${conflictDescription}

Aircraft involved:
${aircraftData.map(aircraft => 
  `- ${aircraft.callsign}: Alt ${aircraft.altitude}ft, Hdg ${aircraft.heading}°, Spd ${aircraft.speed || 'unknown'}`
).join('\n')}

Current context: ${this.context}

Provide 2-3 safe resolution options with:
1. Clear description of the resolution
2. Step-by-step instructions for controllers
3. Estimated time to resolve
4. Confidence level in the solution

Prioritize safety and standard ATC procedures.
    `.trim();
  }

  private containsAviationTerms(text: string): boolean {
    const lowerText = text.toLowerCase();
    return this.aviationVocabulary.some(term => lowerText.includes(term));
  }
}