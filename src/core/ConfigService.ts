import { config } from 'dotenv';
import Joi from 'joi';
import { IConfigService, ILogger } from '../interfaces/IService';
import { SystemConfig } from '../types';

export class ConfigService implements IConfigService {
  private configuration: SystemConfig;
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger;
    
    // Load environment variables
    config();
    
    // Build configuration from environment
    this.configuration = this.buildConfiguration();
    
    // Validate configuration
    this.validateConfiguration();
  }

  async initialize(): Promise<void> {
    this.logger?.info('ConfigService initialized');
  }

  async shutdown(): Promise<void> {
    this.logger?.info('ConfigService shutdown');
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  get<T>(key: string): T {
    const keys = key.split('.');
    let value: any = this.configuration;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        throw new Error(`Configuration key '${key}' not found`);
      }
    }
    
    return value as T;
  }

  set(key: string, value: any): void {
    const keys = key.split('.');
    let current: any = this.configuration;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in current)) {
        current[k] = {};
      }
      current = current[k];
    }
    
    current[keys[keys.length - 1]] = value;
    this.logger?.debug(`Configuration updated: ${key} = ${JSON.stringify(value)}`);
  }

  getConfig(): SystemConfig {
    return { ...this.configuration };
  }

  private buildConfiguration(): SystemConfig {
    return {
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4',
        whisperModel: process.env.WHISPER_MODEL || 'whisper-1'
      },
      database: {
        influxdb: {
          url: process.env.INFLUXDB_URL || 'http://localhost:8086',
          token: process.env.INFLUXDB_TOKEN || '',
          org: process.env.INFLUXDB_ORG || 'atc-assistant',
          bucket: process.env.INFLUXDB_BUCKET || 'aircraft-data'
        },
        mongodb: {
          url: process.env.MONGODB_URL || 'mongodb://localhost:27017',
          database: process.env.MONGODB_DATABASE || 'atc-assistant'
        },
        redis: {
          url: process.env.REDIS_URL || 'redis://localhost:6379',
          password: process.env.REDIS_PASSWORD || undefined
        }
      },
      alerts: {
        conflictDetectionInterval: parseInt(process.env.CONFLICT_DETECTION_INTERVAL || '5000'),
        transcriptionTimeout: parseInt(process.env.TRANSCRIPTION_TIMEOUT || '2000'),
        alertRetentionDays: parseInt(process.env.ALERT_RETENTION_DAYS || '30')
      },
      airport: {
        code: process.env.AIRPORT_CODE || 'EWR',
        runways: (process.env.AIRPORT_RUNWAYS || '4L,4R,11,22L,22R,29').split(','),
        frequencies: (process.env.ATC_FREQUENCIES || '118.85,119.2,121.9,124.7').split(',')
      }
    };
  }

  private validateConfiguration(): void {
    const schema = Joi.object({
      openai: Joi.object({
        apiKey: Joi.string().required(),
        model: Joi.string().required(),
        whisperModel: Joi.string().required()
      }).required(),
      database: Joi.object({
        influxdb: Joi.object({
          url: Joi.string().uri().required(),
          token: Joi.string().required(),
          org: Joi.string().required(),
          bucket: Joi.string().required()
        }).required(),
        mongodb: Joi.object({
          url: Joi.string().uri().required(),
          database: Joi.string().required()
        }).required(),
        redis: Joi.object({
          url: Joi.string().uri().required(),
          password: Joi.string().allow('', null).optional()
        }).required()
      }).required(),
      alerts: Joi.object({
        conflictDetectionInterval: Joi.number().min(1000).required(),
        transcriptionTimeout: Joi.number().min(500).required(),
        alertRetentionDays: Joi.number().min(1).required()
      }).required(),
      airport: Joi.object({
        code: Joi.string().length(3).required(),
        runways: Joi.array().items(Joi.string()).min(1).required(),
        frequencies: Joi.array().items(Joi.string()).min(1).required()
      }).required()
    });

    const { error } = schema.validate(this.configuration);
    if (error) {
      const errorMessage = `Configuration validation failed: ${error.details.map(d => d.message).join(', ')}`;
      this.logger?.error(errorMessage);
      throw new Error(errorMessage);
    }

    this.logger?.info('Configuration validation passed');
  }
}