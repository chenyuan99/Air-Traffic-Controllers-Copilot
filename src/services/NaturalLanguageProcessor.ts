import { IService, ILogger, IConfigService } from '../interfaces/IService';
import { ComplianceResult, ResolutionOption, Aircraft, Conflict } from '../types';
import { OpenAIService } from './OpenAIService';
import { EventEmitter } from '../core/EventEmitter';

export interface CommunicationAnalysis {
  intent: CommunicationIntent;
  entities: ExtractedEntity[];
  confidence: number;
  urgency: UrgencyLevel;
  requiresResponse: boolean;
}

export interface CommunicationIntent {
  type: IntentType;
  action: string;
  target?: string;
  parameters: { [key: string]: any };
}

export interface ExtractedEntity {
  type: EntityType;
  value: string;
  confidence: number;
  position: { start: number; end: number };
}

export enum IntentType {
  CLEARANCE_REQUEST = 'CLEARANCE_REQUEST',
  CLEARANCE_ACKNOWLEDGMENT = 'CLEARANCE_ACKNOWLEDGMENT',
  POSITION_REPORT = 'POSITION_REPORT',
  EMERGENCY_DECLARATION = 'EMERGENCY_DECLARATION',
  WEATHER_REQUEST = 'WEATHER_REQUEST',
  FREQUENCY_CHANGE = 'FREQUENCY_CHANGE',
  RUNWAY_REQUEST = 'RUNWAY_REQUEST',
  TAXI_INSTRUCTION = 'TAXI_INSTRUCTION',
  ALTITUDE_REQUEST = 'ALTITUDE_REQUEST',
  HEADING_INSTRUCTION = 'HEADING_INSTRUCTION',
  SPEED_INSTRUCTION = 'SPEED_INSTRUCTION',
  HOLD_INSTRUCTION = 'HOLD_INSTRUCTION',
  UNKNOWN = 'UNKNOWN'
}

export enum EntityType {
  CALLSIGN = 'CALLSIGN',
  ALTITUDE = 'ALTITUDE',
  HEADING = 'HEADING',
  SPEED = 'SPEED',
  RUNWAY = 'RUNWAY',
  FREQUENCY = 'FREQUENCY',
  WAYPOINT = 'WAYPOINT',
  TIME = 'TIME',
  WEATHER = 'WEATHER'
}

export enum UrgencyLevel {
  ROUTINE = 'ROUTINE',
  PRIORITY = 'PRIORITY',
  URGENT = 'URGENT',
  EMERGENCY = 'EMERGENCY'
}

export class NaturalLanguageProcessor implements IService {
  private openAIService: OpenAIService;
  private logger: ILogger;
  private config: IConfigService;
  private eventEmitter: EventEmitter;
  private conversationContext = new Map<string, string[]>();
  private entityPatterns: Map<EntityType, RegExp[]>;

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
    this.initializeEntityPatterns();
  }

  async initialize(): Promise<void> {
    await this.openAIService.initialize();
    this.logger.info('Natural Language Processor initialized');
  }

  async shutdown(): Promise<void> {
    await this.openAIService.shutdown();
    this.conversationContext.clear();
    this.logger.info('Natural Language Processor shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    return await this.openAIService.isHealthy();
  }

  // Analyze communication for intent and entities
  async analyzeCommunication(
    transcription: string,
    frequency: string,
    callsign?: string
  ): Promise<CommunicationAnalysis> {
    try {
      const startTime = Date.now();

      // Get conversation context
      const context = this.getConversationContext(frequency);
      
      // Extract entities using pattern matching (fast fallback)
      const entities = this.extractEntitiesWithPatterns(transcription);
      
      // Analyze with GPT-4 for intent and detailed analysis
      const aiAnalysis = await this.analyzeWithGPT4(transcription, context, entities);
      
      // Determine urgency level
      const urgency = this.determineUrgency(transcription, aiAnalysis.intent);
      
      // Check if response is required
      const requiresResponse = this.checkResponseRequired(aiAnalysis.intent, transcription);

      const analysis: CommunicationAnalysis = {
        intent: aiAnalysis.intent,
        entities: [...entities, ...aiAnalysis.entities],
        confidence: aiAnalysis.confidence,
        urgency,
        requiresResponse
      };

      // Update conversation context
      this.updateConversationContext(frequency, transcription, callsign);

      const processingTime = Date.now() - startTime;
      
      this.logger.info('Communication analysis completed', {
        intentType: analysis.intent.type,
        entityCount: analysis.entities.length,
        urgency: analysis.urgency,
        confidence: analysis.confidence,
        processingTime,
        frequency
      });

      // Emit analysis event
      this.eventEmitter.emit('nlp:analysis_completed', {
        frequency,
        callsign,
        analysis,
        transcription
      });

      return analysis;
    } catch (error) {
      this.logger.error('Communication analysis failed', error as Error, {
        transcription: transcription.substring(0, 100),
        frequency
      });
      
      // Return fallback analysis
      return this.createFallbackAnalysis(transcription);
    }
  }

  // Check phraseology compliance with detailed analysis
  async checkPhraseologyCompliance(
    transcription: string,
    expectedType?: IntentType
  ): Promise<ComplianceResult> {
    try {
      // Use OpenAI service for compliance checking
      const result = await this.openAIService.checkPhraseologyCompliance(transcription);
      
      // Enhance with additional checks
      const enhancedResult = await this.enhanceComplianceCheck(result, transcription, expectedType);
      
      this.logger.info('Phraseology compliance check completed', {
        isCompliant: enhancedResult.isCompliant,
        confidence: enhancedResult.confidence,
        issueCount: enhancedResult.issues.length
      });

      return enhancedResult;
    } catch (error) {
      this.logger.error('Phraseology compliance check failed', error as Error);
      
      return {
        isCompliant: false,
        confidence: 0.1,
        issues: ['Compliance check failed due to system error'],
        suggestions: ['Manual review required']
      };
    }
  }

  // Generate conflict resolution suggestions with context
  async generateConflictResolutions(
    conflict: Conflict,
    additionalContext?: string
  ): Promise<ResolutionOption[]> {
    try {
      // Build detailed conflict description
      const conflictDescription = this.buildConflictDescription(conflict);
      
      // Prepare aircraft data
      const aircraftData = conflict.aircraftInvolved.map(aircraft => ({
        callsign: aircraft.callsign,
        altitude: aircraft.altitude,
        heading: aircraft.heading,
        speed: aircraft.velocity ? Math.sqrt(
          aircraft.velocity.x ** 2 + aircraft.velocity.y ** 2
        ) : 'unknown',
        position: aircraft.currentPosition,
        status: aircraft.status
      }));

      // Update context with additional information
      if (additionalContext) {
        this.openAIService.updateContext(additionalContext);
      }

      // Generate resolutions using OpenAI
      const resolutions = await this.openAIService.generateConflictResolutions(
        conflictDescription,
        aircraftData
      );

      // Enhance resolutions with safety checks
      const enhancedResolutions = await this.enhanceResolutions(resolutions, conflict);

      this.logger.info('Conflict resolutions generated', {
        conflictId: conflict.id,
        conflictType: conflict.conflictType,
        resolutionCount: enhancedResolutions.length,
        aircraftCount: conflict.aircraftInvolved.length
      });

      return enhancedResolutions;
    } catch (error) {
      this.logger.error('Conflict resolution generation failed', error as Error, {
        conflictId: conflict.id
      });
      
      // Return safe fallback resolution
      return [{
        id: `fallback-${conflict.id}`,
        description: 'Manual intervention required',
        instructions: [
          'Contact supervisor immediately',
          'Implement manual separation procedures',
          'Monitor aircraft closely until conflict resolved'
        ],
        estimatedResolutionTime: 300,
        confidence: 0.1
      }];
    }
  }

  // Extract structured data from communications
  async extractStructuredData(
    transcription: string,
    dataType: 'clearance' | 'position_report' | 'weather_report'
  ): Promise<any> {
    try {
      const prompt = this.buildExtractionPrompt(transcription, dataType);
      
      const result = await this.openAIService.getClient().executeWithRetry(async () => {
        const response = await this.openAIService.getClient().getClient().chat.completions.create({
          model: this.config.get<string>('openai.model'),
          messages: [
            {
              role: 'system',
              content: 'You are an expert at extracting structured data from air traffic control communications.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 400,
          functions: [this.getExtractionFunction(dataType)],
          function_call: { name: `extract_${dataType}` }
        });

        return response;
      });

      const functionCall = result.choices[0]?.message?.function_call;
      if (functionCall && functionCall.arguments) {
        const extractedData = JSON.parse(functionCall.arguments);
        
        this.logger.info('Structured data extracted', {
          dataType,
          transcriptionLength: transcription.length
        });
        
        return extractedData;
      }

      throw new Error('No structured data extracted');
    } catch (error) {
      this.logger.error('Structured data extraction failed', error as Error, { dataType });
      return null;
    }
  }

  // Get conversation context for a frequency
  getConversationContext(frequency: string): string[] {
    return this.conversationContext.get(frequency) || [];
  }

  // Clear conversation context
  clearConversationContext(frequency?: string): void {
    if (frequency) {
      this.conversationContext.delete(frequency);
    } else {
      this.conversationContext.clear();
    }
  }

  // Private helper methods
  private initializeEntityPatterns(): void {
    this.entityPatterns = new Map([
      [EntityType.CALLSIGN, [
        /\b[A-Z]{2,3}\d{1,4}[A-Z]?\b/g, // Standard airline callsigns
        /\b[A-Z]+\s*\d+\b/g // General aviation callsigns
      ]],
      [EntityType.ALTITUDE, [
        /\b(?:flight level|FL)\s*(\d{2,3})\b/gi,
        /\b(\d{1,2}),?(\d{3})\s*(?:feet|ft)\b/gi,
        /\baltitude\s*(\d{1,5})\b/gi
      ]],
      [EntityType.HEADING, [
        /\b(?:heading|hdg)\s*(\d{1,3})\s*(?:degrees?)?\b/gi,
        /\bturn\s*(?:left|right)\s*(?:to\s*)?(\d{1,3})\b/gi
      ]],
      [EntityType.SPEED, [
        /\b(\d{2,3})\s*(?:knots?|kts?)\b/gi,
        /\bspeed\s*(\d{2,3})\b/gi
      ]],
      [EntityType.RUNWAY, [
        /\brunway\s*(\d{1,2}[LRC]?)\b/gi,
        /\bRWY\s*(\d{1,2}[LRC]?)\b/gi
      ]],
      [EntityType.FREQUENCY, [
        /\b(\d{3}\.\d{1,3})\b/g, // Radio frequencies
        /\bcontact\s*(?:tower|ground|approach)\s*(\d{3}\.\d{1,3})\b/gi
      ]]
    ]);
  }

  private extractEntitiesWithPatterns(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    
    for (const [entityType, patterns] of this.entityPatterns) {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          entities.push({
            type: entityType,
            value: match[1] || match[0],
            confidence: 0.8, // Pattern-based extraction confidence
            position: {
              start: match.index,
              end: match.index + match[0].length
            }
          });
        }
      }
    }
    
    return entities;
  }

  private async analyzeWithGPT4(
    transcription: string,
    context: string[],
    entities: ExtractedEntity[]
  ): Promise<{
    intent: CommunicationIntent;
    entities: ExtractedEntity[];
    confidence: number;
  }> {
    const prompt = this.buildAnalysisPrompt(transcription, context, entities);
    
    const result = await this.openAIService.getClient().executeWithRetry(async () => {
      const response = await this.openAIService.getClient().getClient().chat.completions.create({
        model: this.config.get<string>('openai.model'),
        messages: [
          {
            role: 'system',
            content: 'You are an expert air traffic control communication analyzer. Analyze the intent and extract entities from ATC communications.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 600,
        functions: [{
          name: 'analyze_communication',
          description: 'Analyze ATC communication for intent and entities',
          parameters: {
            type: 'object',
            properties: {
              intent: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: Object.values(IntentType) },
                  action: { type: 'string' },
                  target: { type: 'string' },
                  parameters: { type: 'object' }
                },
                required: ['type', 'action']
              },
              entities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: Object.values(EntityType) },
                    value: { type: 'string' },
                    confidence: { type: 'number' }
                  }
                }
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 }
            },
            required: ['intent', 'entities', 'confidence']
          }
        }],
        function_call: { name: 'analyze_communication' }
      });

      return response;
    });

    const functionCall = result.choices[0]?.message?.function_call;
    if (functionCall && functionCall.arguments) {
      return JSON.parse(functionCall.arguments);
    }

    throw new Error('Failed to analyze communication with GPT-4');
  }

  private determineUrgency(transcription: string, intent: CommunicationIntent): UrgencyLevel {
    const urgentKeywords = ['emergency', 'mayday', 'pan pan', 'urgent', 'immediate'];
    const priorityKeywords = ['priority', 'expedite', 'asap'];
    
    const lowerText = transcription.toLowerCase();
    
    if (urgentKeywords.some(keyword => lowerText.includes(keyword))) {
      return UrgencyLevel.EMERGENCY;
    }
    
    if (priorityKeywords.some(keyword => lowerText.includes(keyword))) {
      return UrgencyLevel.URGENT;
    }
    
    if (intent.type === IntentType.EMERGENCY_DECLARATION) {
      return UrgencyLevel.EMERGENCY;
    }
    
    if (intent.type === IntentType.CLEARANCE_REQUEST) {
      return UrgencyLevel.PRIORITY;
    }
    
    return UrgencyLevel.ROUTINE;
  }

  private checkResponseRequired(intent: CommunicationIntent, transcription: string): boolean {
    const responseRequiredIntents = [
      IntentType.CLEARANCE_REQUEST,
      IntentType.EMERGENCY_DECLARATION,
      IntentType.WEATHER_REQUEST,
      IntentType.RUNWAY_REQUEST,
      IntentType.ALTITUDE_REQUEST
    ];
    
    return responseRequiredIntents.includes(intent.type) ||
           transcription.toLowerCase().includes('request') ||
           transcription.toLowerCase().includes('say again');
  }

  private updateConversationContext(frequency: string, transcription: string, callsign?: string): void {
    const context = this.conversationContext.get(frequency) || [];
    const contextEntry = callsign ? `${callsign}: ${transcription}` : transcription;
    
    context.push(contextEntry);
    
    // Keep only last 10 exchanges for context
    if (context.length > 10) {
      context.shift();
    }
    
    this.conversationContext.set(frequency, context);
  }

  private createFallbackAnalysis(transcription: string): CommunicationAnalysis {
    return {
      intent: {
        type: IntentType.UNKNOWN,
        action: 'unknown',
        parameters: {}
      },
      entities: this.extractEntitiesWithPatterns(transcription),
      confidence: 0.1,
      urgency: UrgencyLevel.ROUTINE,
      requiresResponse: false
    };
  }

  private async enhanceComplianceCheck(
    result: ComplianceResult,
    transcription: string,
    expectedType?: IntentType
  ): Promise<ComplianceResult> {
    // Add additional compliance checks based on expected communication type
    const enhancedIssues = [...result.issues];
    const enhancedSuggestions = [...result.suggestions];
    
    // Check for missing standard elements
    if (expectedType === IntentType.CLEARANCE_ACKNOWLEDGMENT) {
      if (!transcription.toLowerCase().includes('roger') && 
          !transcription.toLowerCase().includes('wilco')) {
        enhancedIssues.push('Missing standard acknowledgment (roger/wilco)');
        enhancedSuggestions.push('Include "roger" or "wilco" in acknowledgment');
      }
    }
    
    return {
      ...result,
      issues: enhancedIssues,
      suggestions: enhancedSuggestions
    };
  }

  private buildConflictDescription(conflict: Conflict): string {
    const aircraft = conflict.aircraftInvolved;
    return `${conflict.conflictType} detected between ${aircraft.length} aircraft. ` +
           `Time to conflict: ${conflict.timeToConflict} seconds. ` +
           `Severity: ${conflict.severity}. ` +
           `Aircraft: ${aircraft.map(a => a.callsign).join(', ')}`;
  }

  private async enhanceResolutions(
    resolutions: ResolutionOption[],
    conflict: Conflict
  ): Promise<ResolutionOption[]> {
    // Add safety checks and validation to resolutions
    return resolutions.map(resolution => ({
      ...resolution,
      confidence: Math.min(resolution.confidence, 0.9), // Cap confidence for safety
      instructions: [
        'Verify aircraft acknowledgment before proceeding',
        ...resolution.instructions,
        'Monitor separation until conflict fully resolved'
      ]
    }));
  }

  private buildAnalysisPrompt(
    transcription: string,
    context: string[],
    entities: ExtractedEntity[]
  ): string {
    return `
Analyze this air traffic control communication:

"${transcription}"

Context (previous communications):
${context.slice(-3).join('\n')}

Already identified entities:
${entities.map(e => `${e.type}: ${e.value}`).join(', ')}

Determine the communication intent, extract any additional entities, and provide confidence score.
    `.trim();
  }

  private buildExtractionPrompt(transcription: string, dataType: string): string {
    return `Extract structured ${dataType} data from this ATC communication: "${transcription}"`;
  }

  private getExtractionFunction(dataType: string): any {
    const functions = {
      clearance: {
        name: 'extract_clearance',
        description: 'Extract clearance information',
        parameters: {
          type: 'object',
          properties: {
            callsign: { type: 'string' },
            altitude: { type: 'number' },
            heading: { type: 'number' },
            speed: { type: 'number' },
            runway: { type: 'string' },
            route: { type: 'string' }
          }
        }
      },
      position_report: {
        name: 'extract_position_report',
        description: 'Extract position report information',
        parameters: {
          type: 'object',
          properties: {
            callsign: { type: 'string' },
            position: { type: 'string' },
            altitude: { type: 'number' },
            time: { type: 'string' }
          }
        }
      },
      weather_report: {
        name: 'extract_weather_report',
        description: 'Extract weather information',
        parameters: {
          type: 'object',
          properties: {
            wind: { type: 'string' },
            visibility: { type: 'string' },
            ceiling: { type: 'string' },
            temperature: { type: 'number' },
            pressure: { type: 'string' }
          }
        }
      }
    };
    
    return functions[dataType as keyof typeof functions];
  }
}