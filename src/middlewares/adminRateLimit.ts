import { FastifyRequest, FastifyReply } from "fastify";
import { getCache } from "../utils/cache";

const cache = getCache();

// Admin export rate limiting middleware
export async function adminExportRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const adminAuth = (request as any).adminAuth;
  if (!adminAuth) {
    return reply.status(401).send({ error: 'Authentication required' });
  }

  const rateLimitKey = `admin_export:${adminAuth.userId}`;
  const windowKey = `admin_export_window:${adminAuth.userId}`;
  
  try {
    // Check current count
    const currentCount = await cache.get(rateLimitKey);
    const count = currentCount ? parseInt(currentCount) : 0;
    
    // Rate limit: 3 exports per hour
    if (count >= 3) {
      const ttl = await cache.exists(windowKey) ? 3600 : 0; // 1 hour
      return reply.status(429).send({
        success: false,
        error: 'Export rate limit exceeded',
        message: 'You can export data 3 times per hour. Please try again later.',
        retryAfter: ttl
      });
    }
    
    // Increment counter
    await cache.set(rateLimitKey, (count + 1).toString(), 3600); // 1 hour TTL
    await cache.set(windowKey, '1', 3600); // Window marker
    
  } catch (error) {
    console.warn('Rate limit check failed:', error);
    // Continue on cache failure (fail open for availability)
  }
}

// Admin bulk operation rate limiting middleware
export async function adminBulkRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const adminAuth = (request as any).adminAuth;
  if (!adminAuth) {
    return reply.status(401).send({ error: 'Authentication required' });
  }

  const rateLimitKey = `admin_bulk:${adminAuth.userId}`;
  
  try {
    // Check current count
    const currentCount = await cache.get(rateLimitKey);
    const count = currentCount ? parseInt(currentCount) : 0;
    
    // Rate limit: 10 bulk operations per 5 minutes
    if (count >= 10) {
      return reply.status(429).send({
        success: false,
        error: 'Bulk operation rate limit exceeded',
        message: 'Too many bulk operations. Please try again in 5 minutes.',
        retryAfter: 300 // 5 minutes
      });
    }
    
    // Increment counter
    await cache.set(rateLimitKey, (count + 1).toString(), 300); // 5 minutes TTL
    
  } catch (error) {
    console.warn('Rate limit check failed:', error);
    // Continue on cache failure (fail open for availability)
  }
}

// General admin rate limiting middleware
export async function adminGeneralRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const adminAuth = (request as any).adminAuth;
  if (!adminAuth) {
    return reply.status(401).send({ error: 'Authentication required' });
  }

  const rateLimitKey = `admin_general:${adminAuth.userId}`;
  
  try {
    // Check current count
    const currentCount = await cache.get(rateLimitKey);
    const count = currentCount ? parseInt(currentCount) : 0;
    
    // Rate limit: 200 requests per minute
    if (count >= 200) {
      return reply.status(429).send({
        success: false,
        error: 'Admin rate limit exceeded',
        message: 'Too many admin requests. Please try again in a minute.',
        retryAfter: 60
      });
    }
    
    // Increment counter
    await cache.set(rateLimitKey, (count + 1).toString(), 60); // 1 minute TTL
    
  } catch (error) {
    console.warn('Rate limit check failed:', error);
    // Continue on cache failure (fail open for availability)
  }
}
