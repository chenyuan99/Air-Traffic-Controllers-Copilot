import { EventEmitter as NodeEventEmitter } from 'events';
import { IEventEmitter, ILogger } from '../interfaces/IService';

export class EventEmitter implements IEventEmitter {
  private emitter: NodeEventEmitter;
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.emitter = new NodeEventEmitter();
    this.logger = logger;
    
    // Set max listeners to handle multiple subscribers
    this.emitter.setMaxListeners(100);
  }

  emit(event: string, data: any): void {
    try {
      this.logger?.debug(`Emitting event: ${event}`, { eventData: data });
      this.emitter.emit(event, data);
    } catch (error) {
      this.logger?.error(`Error emitting event: ${event}`, error as Error);
    }
  }

  on(event: string, handler: (data: any) => void): void {
    this.logger?.debug(`Registering handler for event: ${event}`);
    this.emitter.on(event, handler);
  }

  off(event: string, handler: (data: any) => void): void {
    this.logger?.debug(`Removing handler for event: ${event}`);
    this.emitter.off(event, handler);
  }

  // Additional utility methods
  once(event: string, handler: (data: any) => void): void {
    this.emitter.once(event, handler);
  }

  removeAllListeners(event?: string): void {
    this.emitter.removeAllListeners(event);
  }

  listenerCount(event: string): number {
    return this.emitter.listenerCount(event);
  }

  getEventNames(): (string | symbol)[] {
    return this.emitter.eventNames();
  }
}