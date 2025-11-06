import winston from 'winston';
import { ILogger } from '../interfaces/IService';

export class Logger implements ILogger {
  private logger: winston.Logger;

  constructor(level: string = 'info') {
    this.logger = winston.createLogger({
      level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'atc-assistant' },
      transports: [
        new winston.transports.File({ 
          filename: 'logs/error.log', 
          level: 'error' 
        }),
        new winston.transports.File({ 
          filename: 'logs/combined.log' 
        }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  error(message: string, error?: Error, meta?: any): void {
    const logData = {
      ...meta,
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : undefined
    };
    this.logger.error(message, logData);
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  // Get the underlying winston logger for advanced usage
  getWinstonLogger(): winston.Logger {
    return this.logger;
  }
}