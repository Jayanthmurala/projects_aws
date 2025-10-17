// Standardized Response Formatter Middleware
// Ensures consistent API response formats across all endpoints

import { FastifyReply } from "fastify";

export interface StandardResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
  message?: string;
  timestamp?: string;
  requestId?: string;
}

export interface PaginatedResponse<T = any> extends StandardResponse<T> {
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Success response helper
export function sendSuccess<T>(
  reply: FastifyReply, 
  data: T, 
  message?: string, 
  statusCode: number = 200
): FastifyReply {
  const response: StandardResponse<T> = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    requestId: reply.request.id
  };

  if (message) {
    response.message = message;
  }

  return reply.status(statusCode).send(response);
}

// Paginated success response helper
export function sendPaginatedSuccess<T>(
  reply: FastifyReply,
  data: T[],
  pagination: {
    page: number;
    limit: number;
    total: number;
  },
  message?: string
): FastifyReply {
  const totalPages = Math.ceil(pagination.total / pagination.limit);
  
  const response: PaginatedResponse<T[]> = {
    success: true,
    data,
    pagination: {
      ...pagination,
      totalPages,
      hasNext: pagination.page < totalPages,
      hasPrev: pagination.page > 1
    },
    timestamp: new Date().toISOString(),
    requestId: reply.request.id
  };

  if (message) {
    response.message = message;
  }

  return reply.status(200).send(response);
}

// Error response helper
export function sendError(
  reply: FastifyReply,
  error: string,
  statusCode: number = 500,
  details?: string
): FastifyReply {
  const response: StandardResponse = {
    success: false,
    error,
    timestamp: new Date().toISOString(),
    requestId: reply.request.id
  };

  if (details) {
    response.details = details;
  }

  return reply.status(statusCode).send(response);
}

// Common error responses
export const ErrorResponses = {
  // 400 Bad Request
  badRequest: (reply: FastifyReply, message: string = "Bad Request", details?: string) => 
    sendError(reply, message, 400, details),

  // 401 Unauthorized
  unauthorized: (reply: FastifyReply, message: string = "Unauthorized", details?: string) => 
    sendError(reply, message, 401, details),

  // 403 Forbidden
  forbidden: (reply: FastifyReply, message: string = "Forbidden", details?: string) => 
    sendError(reply, message, 403, details),

  // 404 Not Found
  notFound: (reply: FastifyReply, message: string = "Resource not found", details?: string) => 
    sendError(reply, message, 404, details),

  // 409 Conflict
  conflict: (reply: FastifyReply, message: string = "Conflict", details?: string) => 
    sendError(reply, message, 409, details),

  // 422 Unprocessable Entity
  unprocessableEntity: (reply: FastifyReply, message: string = "Validation failed", details?: string) => 
    sendError(reply, message, 422, details),

  // 429 Too Many Requests
  tooManyRequests: (reply: FastifyReply, message: string = "Too many requests", details?: string) => 
    sendError(reply, message, 429, details),

  // 500 Internal Server Error
  internalError: (reply: FastifyReply, message: string = "Internal server error", details?: string) => 
    sendError(reply, message, 500, details),

  // 503 Service Unavailable
  serviceUnavailable: (reply: FastifyReply, message: string = "Service unavailable", details?: string) => 
    sendError(reply, message, 503, details)
};

// Validation error formatter
export function formatValidationError(validationError: any): { error: string; details: string } {
  if (validationError.validation) {
    const errors = validationError.validation.map((err: any) => {
      const field = err.instancePath || err.schemaPath || 'unknown';
      return `${field}: ${err.message}`;
    });
    
    return {
      error: "Validation failed",
      details: errors.join(', ')
    };
  }

  return {
    error: "Validation failed",
    details: validationError.message || "Invalid input data"
  };
}

// Response formatter plugin for Fastify
export async function responseFormatterPlugin(fastify: any) {
  // Add response helpers to reply object
  fastify.decorateReply('sendSuccess', function(this: any, data: any, message?: string, statusCode?: number) {
    return sendSuccess(this, data, message, statusCode);
  });

  fastify.decorateReply('sendPaginatedSuccess', function(this: any, data: any[], pagination: any, message?: string) {
    return sendPaginatedSuccess(this, data, pagination, message);
  });

  fastify.decorateReply('sendError', function(this: any, error: string, statusCode?: number, details?: string) {
    return sendError(this, error, statusCode, details);
  });

  // Add common error response helpers
  Object.keys(ErrorResponses).forEach(key => {
    fastify.decorateReply(key, function(this: any, ...args: any[]) {
      return (ErrorResponses as any)[key](this, ...args);
    });
  });
}

// Type augmentation for Fastify reply
declare module 'fastify' {
  interface FastifyReply {
    sendSuccess<T>(data: T, message?: string, statusCode?: number): FastifyReply;
    sendPaginatedSuccess<T>(data: T[], pagination: { page: number; limit: number; total: number }, message?: string): FastifyReply;
    sendError(error: string, statusCode?: number, details?: string): FastifyReply;
    badRequest(message?: string, details?: string): FastifyReply;
    unauthorized(message?: string, details?: string): FastifyReply;
    forbidden(message?: string, details?: string): FastifyReply;
    notFound(message?: string, details?: string): FastifyReply;
    conflict(message?: string, details?: string): FastifyReply;
    unprocessableEntity(message?: string, details?: string): FastifyReply;
    tooManyRequests(message?: string, details?: string): FastifyReply;
    internalError(message?: string, details?: string): FastifyReply;
    serviceUnavailable(message?: string, details?: string): FastifyReply;
  }
}
