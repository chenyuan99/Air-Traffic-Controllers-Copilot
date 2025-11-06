import { IService, ILogger } from '../interfaces/IService';

export class ServiceContainer {
  private services: Map<string, IService> = new Map();
  private singletons: Map<string, any> = new Map();
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger;
  }

  // Register a service class
  register<T extends IService>(name: string, serviceClass: new (...args: any[]) => T): void {
    this.services.set(name, serviceClass as any);
    this.logger?.debug(`Registered service: ${name}`);
  }

  // Register a singleton instance
  registerSingleton<T>(name: string, instance: T): void {
    this.singletons.set(name, instance);
    this.logger?.debug(`Registered singleton: ${name}`);
  }

  // Get a service instance (creates new instance each time)
  get<T>(name: string): T {
    // Check for singleton first
    if (this.singletons.has(name)) {
      return this.singletons.get(name) as T;
    }

    // Create new instance from registered service
    const ServiceClass = this.services.get(name);
    if (!ServiceClass) {
      throw new Error(`Service '${name}' not found. Make sure it's registered.`);
    }

    try {
      return new (ServiceClass as any)() as T;
    } catch (error) {
      this.logger?.error(`Failed to create service instance: ${name}`, error as Error);
      throw error;
    }
  }

  // Get or create singleton instance
  getSingleton<T>(name: string): T {
    if (this.singletons.has(name)) {
      return this.singletons.get(name) as T;
    }

    const ServiceClass = this.services.get(name);
    if (!ServiceClass) {
      throw new Error(`Service '${name}' not found. Make sure it's registered.`);
    }

    try {
      const instance = new (ServiceClass as any)() as T;
      this.singletons.set(name, instance);
      this.logger?.debug(`Created singleton instance: ${name}`);
      return instance;
    } catch (error) {
      this.logger?.error(`Failed to create singleton instance: ${name}`, error as Error);
      throw error;
    }
  }

  // Initialize all registered services
  async initializeAll(): Promise<void> {
    this.logger?.info('Initializing all services...');
    
    const initPromises: Promise<void>[] = [];
    
    // Initialize singletons
    for (const [name, instance] of this.singletons) {
      if (instance && typeof instance.initialize === 'function') {
        initPromises.push(
          instance.initialize().catch((error: Error) => {
            this.logger?.error(`Failed to initialize singleton ${name}`, error);
            throw error;
          })
        );
      }
    }

    await Promise.all(initPromises);
    this.logger?.info(`Initialized ${initPromises.length} services`);
  }

  // Shutdown all services
  async shutdownAll(): Promise<void> {
    this.logger?.info('Shutting down all services...');
    
    const shutdownPromises: Promise<void>[] = [];
    
    // Shutdown singletons
    for (const [name, instance] of this.singletons) {
      if (instance && typeof instance.shutdown === 'function') {
        shutdownPromises.push(
          instance.shutdown().catch((error: Error) => {
            this.logger?.error(`Failed to shutdown singleton ${name}`, error);
          })
        );
      }
    }

    await Promise.all(shutdownPromises);
    this.logger?.info('All services shut down');
  }

  // Check health of all services
  async checkHealth(): Promise<{ [serviceName: string]: boolean }> {
    const healthStatus: { [serviceName: string]: boolean } = {};
    
    for (const [name, instance] of this.singletons) {
      if (instance && typeof instance.isHealthy === 'function') {
        try {
          healthStatus[name] = await instance.isHealthy();
        } catch (error) {
          this.logger?.error(`Health check failed for ${name}`, error as Error);
          healthStatus[name] = false;
        }
      }
    }

    return healthStatus;
  }

  // List all registered services
  listServices(): string[] {
    return Array.from(this.services.keys());
  }

  // List all singleton instances
  listSingletons(): string[] {
    return Array.from(this.singletons.keys());
  }
}