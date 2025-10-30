import { FastifyRequest, FastifyReply } from 'fastify';
import { getCache } from '../utils/cache';
import { logger } from '../utils/logger';

const cache = getCache();

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  keyGenerator?: (req: FastifyRequest) => string;
  skipCache?: (req: FastifyRequest) => boolean;
  varyBy?: string[]; // Headers to vary cache by (e.g., ['authorization'])
}

/**
 * Response caching middleware for API endpoints
 * Uses Redis in production, in-memory cache in development
 */
export function createCacheMiddleware(options: CacheOptions = {}) {
  const {
    ttl = 300, // 5 minutes default
    keyGenerator,
    skipCache,
    varyBy = []
  } = options;

  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Skip caching if specified
    if (skipCache && skipCache(req)) {
      return;
    }

    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return;
    }

    // Generate cache key
    const cacheKey = keyGenerator ? keyGenerator(req) : generateDefaultCacheKey(req, varyBy);
    
    try {
      // Try to get cached response
      const cachedResponse = await cache.get(cacheKey);
      
      if (cachedResponse) {
        const parsed = JSON.parse(cachedResponse);
        
        // Add cache headers
        reply.header('X-Cache', 'HIT');
        reply.header('X-Cache-Key', cacheKey);
        
        logger.debug({ cacheKey, url: req.url }, 'Cache hit');
        
        return reply.send(parsed);
      }

      // Cache miss - continue to route handler
      logger.debug({ cacheKey, url: req.url }, 'Cache miss');
      
      // Store the cache key and TTL for later use in route handler
      (req as any).cacheKey = cacheKey;
      (req as any).cacheTTL = ttl;
      
      // Add cache headers for miss
      reply.header('X-Cache', 'MISS');
      reply.header('X-Cache-Key', cacheKey);

    } catch (error) {
      logger.warn({ error, cacheKey }, 'Cache middleware error');
      // Continue without caching on error
    }
  };
}

/**
 * Generate a default cache key based on URL, query params, and vary headers
 */
function generateDefaultCacheKey(req: FastifyRequest, varyBy: string[]): string {
  const url = req.url;
  const method = req.method;
  
  // Include vary headers in cache key
  const varyValues = varyBy.map(header => {
    const value = req.headers[header.toLowerCase()];
    return `${header}:${value || 'none'}`;
  }).join('|');
  
  const baseKey = `api_cache:${method}:${url}`;
  
  return varyValues ? `${baseKey}:${Buffer.from(varyValues).toString('base64')}` : baseKey;
}

/**
 * Cache key generators for common patterns
 */
export const CacheKeyGenerators = {
  /**
   * Generate cache key for user-specific data
   */
  userSpecific: (prefix: string) => (req: FastifyRequest): string => {
    const user = (req as any).user;
    const userId = user?.sub || 'anonymous';
    const url = req.url;
    return `${prefix}:user:${userId}:${Buffer.from(url).toString('base64')}`;
  },

  /**
   * Generate cache key for college-specific data
   */
  collegeSpecific: (prefix: string) => (req: FastifyRequest): string => {
    const user = (req as any).user;
    const collegeId = user?.scope?.collegeId || 'no-college';
    const url = req.url;
    return `${prefix}:college:${collegeId}:${Buffer.from(url).toString('base64')}`;
  },

  /**
   * Generate cache key for public data that varies by query params
   */
  queryBased: (prefix: string) => (req: FastifyRequest): string => {
    const url = req.url;
    return `${prefix}:query:${Buffer.from(url).toString('base64')}`;
  }
};

/**
 * Helper function to cache response data from route handlers
 */
export async function cacheResponse(req: FastifyRequest, reply: FastifyReply, data: any): Promise<void> {
  const cacheKey = (req as any).cacheKey;
  const cacheTTL = (req as any).cacheTTL;
  
  if (cacheKey && cacheTTL && reply.statusCode >= 200 && reply.statusCode < 300) {
    try {
      const responseData = JSON.stringify(data);
      await cache.set(cacheKey, responseData, cacheTTL);
      
      reply.header('X-Cache-TTL', cacheTTL.toString());
      logger.debug({ cacheKey, ttl: cacheTTL, url: req.url }, 'Response cached');
    } catch (error) {
      logger.warn({ error, cacheKey }, 'Failed to cache response');
    }
  }
}

/**
 * Cache invalidation helper
 */
export class CacheInvalidator {
  /**
   * Invalidate cache entries by pattern (for Redis, this would use SCAN)
   * For in-memory cache, we'll need to track keys
   */
  static async invalidateByPattern(pattern: string): Promise<void> {
    try {
      // This is a simplified implementation
      // In production with Redis, you'd use SCAN to find matching keys
      logger.debug({ pattern }, 'Cache invalidation by pattern requested');
      
      // For now, we'll just log the invalidation request
      // The actual implementation would depend on the cache backend
    } catch (error) {
      logger.error({ error, pattern }, 'Failed to invalidate cache by pattern');
    }
  }

  /**
   * Invalidate specific cache key
   */
  static async invalidateKey(key: string): Promise<void> {
    try {
      await cache.del(key);
      logger.debug({ key }, 'Cache key invalidated');
    } catch (error) {
      logger.error({ error, key }, 'Failed to invalidate cache key');
    }
  }
}
