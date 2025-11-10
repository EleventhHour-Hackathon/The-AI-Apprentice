import { logDiagnostic } from './uploadDiagnostics';

interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  onRetry?: (attempt: number, delay: number, error: Error) => void;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffFactor: 2,
  onRetry: () => {},
  shouldRetry: (error: Error) => {
    // Retry on network errors and specific HTTP status codes
    const message = error.message.toLowerCase();
    
    // Don't retry on permanent failures
    if (message.includes('401') || message.includes('unauthorized')) {
      return false;
    }
    if (message.includes('404') || message.includes('not found')) {
      return false;
    }
    
    // Retry on temporary failures
    if (message.includes('network')) return true;
    if (message.includes('timeout')) return true;
    if (message.includes('503')) return true; // Service unavailable
    if (message.includes('502')) return true; // Bad gateway
    if (message.includes('429')) return true; // Too many requests
    if (message.includes('500')) return true; // Internal server error
    if (message.includes('expired')) return true; // Expired presigned URL
    
    // Retry on S3 specific errors that are retryable
    if (message.includes('403') && message.includes('expired')) return true;
    if (message.includes('request timeout')) return true;
    if (message.includes('slow down')) return true;
    
    return false;
  }
};

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error = new Error('Unknown error');
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      // Log attempt
      if (attempt > 1) {
        logDiagnostic('upload_error', {
          operation: operationName,
          attempt,
          retrying: true,
          lastError: lastError.message
        });
      }
      
      // Execute the operation
      const result = await operation();
      
      // Log success after retry
      if (attempt > 1) {
        logDiagnostic('upload_progress', {
          operation: operationName,
          status: 'recovered',
          attemptsTaken: attempt
        });
      }
      
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if we should retry
      if (attempt >= config.maxAttempts || !config.shouldRetry(lastError, attempt)) {
        logDiagnostic('upload_error', {
          operation: operationName,
          attempt,
          maxAttempts: config.maxAttempts,
          error: lastError.message,
          retryExhausted: true
        });
        throw lastError;
      }
      
      // Calculate delay with exponential backoff
      const baseDelay = config.initialDelay * Math.pow(config.backoffFactor, attempt - 1);
      const jitter = Math.random() * 0.3 * baseDelay; // Add 30% jitter
      const delay = Math.min(baseDelay + jitter, config.maxDelay);
      
      // Notify about retry
      config.onRetry(attempt, delay, lastError);
      
      console.log(
        `⏳ Retrying ${operationName} (attempt ${attempt}/${config.maxAttempts}) after ${Math.round(delay)}ms...`
      );
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Specialized retry for S3 uploads
export async function retryS3Upload<T>(
  uploadFn: () => Promise<T>,
  uploadId: string,
  partNumber?: number
): Promise<T> {
  return retryWithBackoff(
    uploadFn,
    partNumber ? `S3 upload part ${partNumber}` : 'S3 upload',
    {
      maxAttempts: 5, // More attempts for uploads
      initialDelay: 2000, // Start with 2 seconds
      maxDelay: 60000, // Max 1 minute between retries
      backoffFactor: 2.5,
      onRetry: (attempt, delay, error) => {
        logDiagnostic('upload_progress', {
          uploadId,
          partNumber,
          retryAttempt: attempt,
          retryDelay: delay,
          retryReason: error.message
        });
      },
      shouldRetry: (error: Error, attempt: number) => {
        const message = error.message.toLowerCase();
        
        // Always retry on network errors for uploads
        if (message.includes('network') || message.includes('fetch')) {
          return attempt <= 5;
        }
        
        // Retry on S3 throttling
        if (message.includes('slow down') || message.includes('429')) {
          return attempt <= 10; // Be more persistent with throttling
        }
        
        // Retry on expired presigned URLs (but only a few times)
        if (message.includes('403') && message.includes('expired')) {
          return attempt <= 2;
        }
        
        // Use default logic for other errors
        return DEFAULT_OPTIONS.shouldRetry(error, attempt);
      }
    }
  );
}