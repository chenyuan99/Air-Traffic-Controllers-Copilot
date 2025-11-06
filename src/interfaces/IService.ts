// Base service interface for dependency injection

export interface IService {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

export interface ILogger {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, error?: Error, meta?: any): void;
  debug(message: string, meta?: any): void;
}

export interface IConfigService extends IService {
  get<T>(key: string): T;
  set(key: string, value: any): void;
  getConfig(): any;
}

export interface IEventEmitter {
  emit(event: string, data: any): void;
  on(event: string, handler: (data: any) => void): void;
  off(event: string, handler: (data: any) => void): void;
}