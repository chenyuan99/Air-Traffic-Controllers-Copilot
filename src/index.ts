import { Logger } from './core/Logger';
import { ConfigService } from './core/ConfigService';
import { ServiceContainer } from './core/ServiceContainer';
import { EventEmitter } from './core/EventEmitter';

async function main() {
  // Initialize core services
  const logger = new Logger(process.env.LOG_LEVEL || 'info');
  const configService = new ConfigService(logger);
  const eventEmitter = new EventEmitter(logger);
  
  // Create service container
  const serviceContainer = new ServiceContainer(logger);
  
  // Register core services as singletons
  serviceContainer.registerSingleton('logger', logger);
  serviceContainer.registerSingleton('config', configService);
  serviceContainer.registerSingleton('eventEmitter', eventEmitter);
  
  try {
    logger.info('Starting ATC Assistant System...');
    
    // Initialize all services
    await serviceContainer.initializeAll();
    
    // Check system health
    const healthStatus = await serviceContainer.checkHealth();
    logger.info('System health check completed', { healthStatus });
    
    // Verify configuration
    const config = configService.getConfig();
    logger.info('System configuration loaded', {
      airport: config.airport.code,
      runways: config.airport.runways.length,
      frequencies: config.airport.frequencies.length
    });
    
    logger.info('ATC Assistant System started successfully');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await serviceContainer.shutdownAll();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await serviceContainer.shutdownAll();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start ATC Assistant System', error as Error);
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error during startup:', error);
    process.exit(1);
  });
}

export { main };