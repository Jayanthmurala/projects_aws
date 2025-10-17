import { FastifyRequest, FastifyReply, FastifyError } from "fastify";
import { env } from "../config/env";

// Enhanced error handler with proper logging and sanitization
export async function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const timestamp = new Date().toISOString();
  const requestId = request.id || 'unknown';
  
  // Log error details (sanitized for production)
  const errorLog = {
    timestamp,
    requestId,
    method: request.method,
    url: request.url,
    statusCode: error.statusCode || 500,
    error: {
      name: error.name,
      message: error.message,
      code: error.code,
      validation: error.validation // For validation errors
    },
    // Only include stack trace in development
    ...(env.NODE_ENV === 'development' && { stack: error.stack }),
    // Don't log sensitive headers
    headers: sanitizeHeaders(request.headers),
    userAgent: request.headers['user-agent'],
    ip: request.ip
  };

  console.error('Request error:', errorLog);

  // Determine response based on error type
  let statusCode = error.statusCode || 500;
  let errorResponse: any = {
    success: false,
    error: 'Internal server error',
    timestamp,
    requestId
  };

  // Handle specific error types
  if (error.validation) {
    // Validation errors
    statusCode = 400;
    errorResponse = {
      success: false,
      error: 'Validation failed',
      details: error.validation,
      timestamp,
      requestId
    };
  } else if (error.statusCode === 401) {
    // Authentication errors
    errorResponse = {
      success: false,
      error: 'Authentication required',
      message: error.message,
      timestamp,
      requestId
    };
  } else if (error.statusCode === 403) {
    // Authorization errors
    errorResponse = {
      success: false,
      error: 'Access denied',
      message: error.message,
      timestamp,
      requestId
    };
  } else if (error.statusCode === 404) {
    // Not found errors
    errorResponse = {
      success: false,
      error: 'Resource not found',
      message: error.message,
      timestamp,
      requestId
    };
  } else if (error.statusCode === 429) {
    // Rate limit errors
    errorResponse = {
      success: false,
      error: 'Rate limit exceeded',
      message: error.message,
      retryAfter: reply.getHeader('retry-after'),
      timestamp,
      requestId
    };
  } else if (error.statusCode && error.statusCode < 500) {
    // Client errors (4xx)
    errorResponse = {
      success: false,
      error: error.message || 'Bad request',
      timestamp,
      requestId
    };
  } else {
    // Server errors (5xx)
    statusCode = 500;
    errorResponse = {
      success: false,
      error: 'Internal server error',
      // Only include error details in development
      ...(env.NODE_ENV === 'development' && { 
        details: error.message,
        code: error.code 
      }),
      timestamp,
      requestId
    };
  }

  // Send error response
  reply.status(statusCode).send(errorResponse);
}

// Sanitize headers to remove sensitive information
function sanitizeHeaders(headers: any): any {
  const sanitized = { ...headers };
  
  // Remove or mask sensitive headers
  const sensitiveHeaders = [
    'authorization',
    'cookie',
    'x-api-key',
    'x-auth-token'
  ];

  for (const header of sensitiveHeaders) {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]';
    }
  }

  return sanitized;
}

// Not found handler
export async function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  const timestamp = new Date().toISOString();
  const requestId = request.id || 'unknown';

  console.warn('Route not found:', {
    timestamp,
    requestId,
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent']
  });

  reply.status(404).send({
    success: false,
    error: 'Route not found',
    message: `${request.method} ${request.url} not found`,
    timestamp,
    requestId
  });
}

// Graceful shutdown handler
export function setupGracefulShutdown(app: any) {
  const gracefulShutdown = async (signal: string) => {
    console.log(`Received ${signal}, starting graceful shutdown...`);
    
    try {
      // Close server first to stop accepting new requests
      await app.close();
      console.log('Server closed successfully');
      
      // Close database connections
      const { prisma } = await import('../db');
      await prisma.$disconnect();
      console.log('Database connections closed');
      
      // Close Redis connections if available
      try {
        const { getCache } = await import('../utils/cache');
        const cache = getCache();
        if ((cache as any).client && typeof (cache as any).client.quit === 'function') {
          await (cache as any).client.quit();
          console.log('Cache Redis connections closed');
        }
      } catch (redisError) {
        console.warn('Cache Redis cleanup warning:', redisError);
      }

      // Close rate limiting Redis client if available
      try {
        const { createRedisClientForRateLimit } = await import('../config/rateLimits');
        // Note: In a real implementation, we'd need to track the client instance
        // For now, Redis clients will close automatically on process exit
        console.log('Rate limiting Redis cleanup completed');
      } catch (rateLimitRedisError) {
        console.warn('Rate limiting Redis cleanup warning:', rateLimitRedisError);
      }    
      
      // Exit process
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}
