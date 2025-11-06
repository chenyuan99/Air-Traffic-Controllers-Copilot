import OpenAI from 'openai';
import { IService, ILogger, IConfigService } from '../interfaces/IService';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
}

export class OpenAIClient implements IService {
  private client: OpenAI;
  private logger: ILogger;
  private config: IConfigService;
  private retryConfig: RetryConfig;
  private rateLimitConfig: RateLimitConfig;
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private lastRequestTime = 0;
  private requestCount = 0;
  private tokenCount = 0;
  private windowStart = Date.now();

  constructor(logger: ILogger, config: IConfigService) {
    this.logger = logger;
    this.config = config;
    
    // Initialize OpenAI client
    const apiKey = this.config.get<string>('openai.apiKey');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    this.client = new OpenAI({
      apiKey,
      timeout: 30000, // 30 second timeout
      maxRetries: 0 // We handle retries ourselves
    });

    // Default retry configuration
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
      backoffMultiplier: 2
    };

    // Default rate limiting (conservative for safety-critical application)
    this.rateLimitConfig = {
      requestsPerMinute: 50,
      tokensPerMinute: 40000
    };
  }

  async initialize(): Promise<void> {
    try {
      // Test the connection with a simple request
      await this.testConnection();
      this.logger.info('OpenAI client initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize OpenAI client', error as Error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    // Wait for any pending requests to complete
    while (this.requestQueue.length > 0 || this.isProcessingQueue) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    this.logger.info('OpenAI client shutdown completed');
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.testConnection();
      return true;
    } catch (error) {
      this.logger.error('OpenAI client health check failed', error as Error);
      return false;
    }
  }

  // Test connection to OpenAI API
  private async testConnection(): Promise<void> {
    await this.executeWithRetry(async () => {
      const response = await this.client.models.list();
      if (!response.data || response.data.length === 0) {
        throw new Error('No models available from OpenAI API');
      }
    });
  }

  // Execute a request with retry logic and rate limiting
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    customRetryConfig?: Partial<RetryConfig>
  ): Promise<T> {
    const config = { ...this.retryConfig, ...customRetryConfig };
    let lastError: Error;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        // Apply rate limiting
        await this.enforceRateLimit();

        // Execute the operation
        const result = await operation();
        
        // Log successful request
        if (attempt > 0) {
          this.logger.info(`OpenAI request succeeded after ${attempt} retries`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // Check if this is a retryable error
        if (!this.isRetryableError(error as Error) || attempt === config.maxRetries) {
          this.logger.error(
            `OpenAI request failed permanently after ${attempt} attempts`,
            lastError,
            { attempt, maxRetries: config.maxRetries }
          );
          throw lastError;
        }

        // Calculate delay for next retry
        const delay = Math.min(
          config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelay
        );

        this.logger.warn(
          `OpenAI request failed, retrying in ${delay}ms`,
          { 
            attempt: attempt + 1, 
            maxRetries: config.maxRetries,
            error: lastError.message 
          }
        );

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }

  // Check if an error is retryable
  private isRetryableError(error: Error): boolean {
    // OpenAI API error types that should be retried
    const retryableErrors = [
      'rate_limit_exceeded',
      'server_error',
      'timeout',
      'connection_error',
      'service_unavailable'
    ];

    // Check for network errors
    if (error.message.includes('ECONNRESET') || 
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('ENOTFOUND')) {
      return true;
    }

    // Check for OpenAI specific errors
    if ('type' in error) {
      return retryableErrors.includes((error as any).type);
    }

    // Check for HTTP status codes
    if ('status' in error) {
      const status = (error as any).status;
      return status >= 500 || status === 429; // Server errors or rate limiting
    }

    return false;
  }

  // Enforce rate limiting
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Reset counters if window has passed
    if (now - this.windowStart >= 60000) { // 1 minute window
      this.requestCount = 0;
      this.tokenCount = 0;
      this.windowStart = now;
    }

    // Check request rate limit
    if (this.requestCount >= this.rateLimitConfig.requestsPerMinute) {
      const waitTime = 60000 - (now - this.windowStart);
      this.logger.warn(`Rate limit reached, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.enforceRateLimit(); // Recursive call after waiting
    }

    // Ensure minimum time between requests
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 60000 / this.rateLimitConfig.requestsPerMinute;
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requestCount++;
    this.lastRequestTime = Date.now();
  }

  // Update token count for rate limiting
  updateTokenCount(tokens: number): void {
    this.tokenCount += tokens;
  }

  // Get the underlying OpenAI client for direct access
  getClient(): OpenAI {
    return this.client;
  }

  // Update retry configuration
  updateRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
    this.logger.info('OpenAI retry configuration updated', { retryConfig: this.retryConfig });
  }

  // Update rate limit configuration
  updateRateLimitConfig(config: Partial<RateLimitConfig>): void {
    this.rateLimitConfig = { ...this.rateLimitConfig, ...config };
    this.logger.info('OpenAI rate limit configuration updated', { rateLimitConfig: this.rateLimitConfig });
  }

  // Get current rate limit status
  getRateLimitStatus(): {
    requestsUsed: number;
    requestsRemaining: number;
    tokensUsed: number;
    tokensRemaining: number;
    windowResetTime: Date;
  } {
    const now = Date.now();
    const windowTimeRemaining = 60000 - (now - this.windowStart);
    
    return {
      requestsUsed: this.requestCount,
      requestsRemaining: Math.max(0, this.rateLimitConfig.requestsPerMinute - this.requestCount),
      tokensUsed: this.tokenCount,
      tokensRemaining: Math.max(0, this.rateLimitConfig.tokensPerMinute - this.tokenCount),
      windowResetTime: new Date(now + windowTimeRemaining)
    };
  }
}