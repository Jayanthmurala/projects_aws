import pino from 'pino';
import { env } from '../config/env';

// Create structured logger with correlation ID support
function createLogger() {
  const baseConfig = {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    formatters: {
      level: (label: string) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // In production, use JSON logging
  if (env.NODE_ENV === 'production') {
    return pino(baseConfig);
  }

  // In development, try to use pino-pretty if available
  try {
    return pino({
      ...baseConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      }
    });
  } catch (error) {
    // Fallback to basic JSON logging if pino-pretty is not available
    console.warn('pino-pretty not available, using JSON logging');
    return pino(baseConfig);
  }
}

export const logger = createLogger();

// Correlation ID utilities
export class CorrelationId {
  private static generateId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  static create(): string {
    return this.generateId();
  }

  static fromRequest(request: any): string {
    // Try to get correlation ID from headers first
    const headerCorrelationId = request.headers['x-correlation-id'] || request.headers['x-request-id'];
    if (headerCorrelationId) {
      return headerCorrelationId;
    }

    // Use Fastify request ID if available
    if (request.id) {
      return `fastify_${request.id}`;
    }

    // Generate new one
    return this.generateId();
  }
}

// Structured logging helpers
export class StructuredLogger {
  static createRequestLogger(correlationId: string, userId?: string) {
    return logger.child({
      correlationId,
      userId,
      component: 'request'
    });
  }

  static createServiceLogger(service: string, correlationId?: string) {
    return logger.child({
      correlationId,
      component: 'service',
      service
    });
  }

  static createDatabaseLogger(correlationId?: string) {
    return logger.child({
      correlationId,
      component: 'database'
    });
  }

  static createCacheLogger(correlationId?: string) {
    return logger.child({
      correlationId,
      component: 'cache'
    });
  }

  static createAuthLogger(correlationId?: string) {
    return logger.child({
      correlationId,
      component: 'auth'
    });
  }

  static createAdminLogger(correlationId?: string, adminId?: string) {
    return logger.child({
      correlationId,
      adminId,
      component: 'admin'
    });
  }
}

// Request logging middleware
export function createRequestLoggingMiddleware() {
  return async (request: any, reply: any) => {
    const correlationId = CorrelationId.fromRequest(request);
    const startTime = Date.now();
    
    // Add correlation ID to request for use in other parts of the app
    request.correlationId = correlationId;
    
    // Add correlation ID to response headers
    reply.header('x-correlation-id', correlationId);
    
    const requestLogger = StructuredLogger.createRequestLogger(
      correlationId, 
      request.user?.sub || request.adminAuth?.userId
    );

    // Log incoming request
    requestLogger.info({
      method: request.method,
      url: request.url,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
      query: request.query,
      // Don't log request body for security (may contain sensitive data)
    }, 'Incoming request');

    // Store the logger and start time on the request for use in onResponse hook
    request.requestLogger = requestLogger;
    request.startTime = startTime;
  };
}

// Error logging helper
export function logError(error: Error, context: any = {}, correlationId?: string) {
  const errorLogger = logger.child({
    correlationId,
    component: 'error'
  });

  errorLogger.error({
    error: {
      name: error.name,
      message: error.message,
      stack: env.NODE_ENV === 'development' ? error.stack : undefined
    },
    context
  }, 'Application error occurred');
}

// Performance logging helper
export function logPerformance(operation: string, duration: number, context: any = {}, correlationId?: string) {
  const perfLogger = logger.child({
    correlationId,
    component: 'performance'
  });

  const level = duration > 1000 ? 'warn' : duration > 500 ? 'info' : 'debug';
  
  perfLogger[level]({
    operation,
    duration,
    context
  }, `Operation ${operation} took ${duration}ms`);
}

// Security event logging
export function logSecurityEvent(event: string, details: any = {}, correlationId?: string, userId?: string) {
  const securityLogger = logger.child({
    correlationId,
    userId,
    component: 'security'
  });

  securityLogger.warn({
    event,
    details,
    timestamp: new Date().toISOString()
  }, `Security event: ${event}`);
}

// Admin action logging
export function logAdminAction(
  adminId: string, 
  action: string, 
  entityType: string, 
  entityId: string, 
  details: any = {},
  correlationId?: string
) {
  const adminLogger = StructuredLogger.createAdminLogger(correlationId, adminId);

  adminLogger.info({
    action,
    entityType,
    entityId,
    details,
    timestamp: new Date().toISOString()
  }, `Admin action: ${action} on ${entityType} ${entityId}`);
}

// Database operation logging
export function logDatabaseOperation(
  operation: string,
  table: string,
  duration: number,
  recordCount?: number,
  correlationId?: string
) {
  const dbLogger = StructuredLogger.createDatabaseLogger(correlationId);

  const level = duration > 2000 ? 'warn' : duration > 1000 ? 'info' : 'debug';

  dbLogger[level]({
    operation,
    table,
    duration,
    recordCount,
  }, `Database ${operation} on ${table} took ${duration}ms${recordCount ? ` (${recordCount} records)` : ''}`);
}

export default logger;
