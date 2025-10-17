import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { rateLimitConfig } from "../config/rateLimits";

// Rate limit middleware factory for specific endpoint types
export function createRateLimitMiddleware(limitType: keyof typeof rateLimitConfig) {
  return async function rateLimitMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const config = rateLimitConfig[limitType];
    
    // Generate the key for this request
    const key = config.keyGenerator(request);
    
    // For now, we'll implement a simple in-memory rate limiter
    // In production, this should use Redis
    const now = Date.now();
    const windowMs = parseTimeWindow(config.timeWindow);
    
    // Get or create rate limit data for this key
    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, { count: 0, resetTime: now + windowMs });
    }
    
    const rateLimitData = rateLimitStore.get(key)!;
    
    // Reset if window has expired
    if (now > rateLimitData.resetTime) {
      rateLimitData.count = 0;
      rateLimitData.resetTime = now + windowMs;
    }
    
    // Check if limit exceeded
    if (rateLimitData.count >= config.max) {
      const retryAfter = Math.ceil((rateLimitData.resetTime - now) / 1000);
      
      reply.headers({
        'X-RateLimit-Limit': config.max,
        'X-RateLimit-Remaining': 0,
        'X-RateLimit-Reset': new Date(rateLimitData.resetTime).toISOString(),
        'Retry-After': retryAfter
      });
      
      const errorResponse = config.errorResponseBuilder(request, { ttl: rateLimitData.resetTime - now });
      return reply.code(429).send(errorResponse);
    }
    
    // Increment counter
    rateLimitData.count++;
    
    // Add rate limit headers
    reply.headers({
      'X-RateLimit-Limit': config.max,
      'X-RateLimit-Remaining': Math.max(0, config.max - rateLimitData.count),
      'X-RateLimit-Reset': new Date(rateLimitData.resetTime).toISOString()
    });
  };
}

// Simple in-memory store (replace with Redis in production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now > data.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

// Helper function to parse time window strings
function parseTimeWindow(timeWindow: string): number {
  const match = timeWindow.match(/^(\d+)\s*(second|minute|hour|day)s?$/i);
  if (!match) {
    throw new Error(`Invalid time window format: ${timeWindow}`);
  }
  
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  
  switch (unit) {
    case 'second': return value * 1000;
    case 'minute': return value * 60 * 1000;
    case 'hour': return value * 60 * 60 * 1000;
    case 'day': return value * 24 * 60 * 60 * 1000;
    default: throw new Error(`Unknown time unit: ${unit}`);
  }
}

// Specific middleware instances for different endpoint types
export const rateLimitAuth = createRateLimitMiddleware('auth');
export const rateLimitFileUpload = createRateLimitMiddleware('fileUpload');
export const rateLimitProjectCreation = createRateLimitMiddleware('projectCreation');
export const rateLimitApplicationSubmission = createRateLimitMiddleware('applicationSubmission');
export const rateLimitAdmin = createRateLimitMiddleware('admin');
