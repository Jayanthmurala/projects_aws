import { env } from "./env";

// Rate limiting configuration for different endpoint types
export const rateLimitConfig = {
  // General API endpoints
  general: {
    max: 100, // requests
    timeWindow: '1 minute',
    skipOnError: true,
    keyGenerator: (req: any) => {
      // Use user ID if authenticated, otherwise IP
      const userId = req.user?.sub;
      return userId ? `user:${userId}` : req.ip;
    },
    errorResponseBuilder: (req: any, context: any) => ({
      error: 'Rate limit exceeded',
      message: 'Too many requests, please try again later',
      retryAfter: Math.round(context.ttl / 1000)
    })
  },

  // Authentication endpoints (more restrictive)
  auth: {
    max: 20,
    timeWindow: '1 minute',
    skipOnError: false,
    keyGenerator: (req: any) => req.ip,
    errorResponseBuilder: (req: any, context: any) => ({
      error: 'Authentication rate limit exceeded',
      message: 'Too many authentication attempts, please try again later',
      retryAfter: Math.round(context.ttl / 1000)
    })
  },

  // File upload endpoints (very restrictive)
  fileUpload: {
    max: 10,
    timeWindow: '1 minute',
    skipOnError: false,
    keyGenerator: (req: any) => {
      const userId = req.user?.sub;
      return userId ? `upload:${userId}` : `upload:${req.ip}`;
    },
    errorResponseBuilder: (req: any, context: any) => ({
      error: 'Upload rate limit exceeded',
      message: 'Too many file uploads, please try again later',
      retryAfter: Math.round(context.ttl / 1000)
    })
  },

  // Project creation (moderately restrictive)
  projectCreation: {
    max: 5,
    timeWindow: '1 minute',
    skipOnError: false,
    keyGenerator: (req: any) => {
      const userId = req.user?.sub;
      return userId ? `create:${userId}` : `create:${req.ip}`;
    },
    errorResponseBuilder: (req: any, context: any) => ({
      error: 'Project creation rate limit exceeded',
      message: 'Too many project creation attempts, please try again later',
      retryAfter: Math.round(context.ttl / 1000)
    })
  },

  // Application submission (moderately restrictive)
  applicationSubmission: {
    max: 10,
    timeWindow: '5 minutes',
    skipOnError: false,
    keyGenerator: (req: any) => {
      const userId = req.user?.sub;
      return userId ? `apply:${userId}` : `apply:${req.ip}`;
    },
    errorResponseBuilder: (req: any, context: any) => ({
      error: 'Application rate limit exceeded',
      message: 'Too many application submissions, please try again later',
      retryAfter: Math.round(context.ttl / 1000)
    })
  },

  // Admin endpoints (more permissive for legitimate admin use)
  admin: {
    max: 200,
    timeWindow: '1 minute',
    skipOnError: true,
    keyGenerator: (req: any) => {
      const userId = req.user?.sub;
      return userId ? `admin:${userId}` : `admin:${req.ip}`;
    },
    errorResponseBuilder: (req: any, context: any) => ({
      error: 'Admin rate limit exceeded',
      message: 'Too many admin requests, please try again later',
      retryAfter: Math.round(context.ttl / 1000)
    })
  },

  // Admin export endpoints (very restrictive)
  adminExport: {
    max: 3,
    timeWindow: '1 hour',
    skipOnError: false,
    keyGenerator: (req: any) => {
      const userId = req.adminAuth?.userId || req.user?.sub;
      return userId ? `admin_export:${userId}` : `admin_export:${req.ip}`;
    },
    errorResponseBuilder: (req: any, context: any) => ({
      error: 'Export rate limit exceeded',
      message: 'Too many export requests. You can export 3 times per hour.',
      retryAfter: Math.round(context.ttl / 1000)
    })
  },

  // Admin bulk operations (restrictive)
  adminBulk: {
    max: 10,
    timeWindow: '5 minutes',
    skipOnError: false,
    keyGenerator: (req: any) => {
      const userId = req.adminAuth?.userId || req.user?.sub;
      return userId ? `admin_bulk:${userId}` : `admin_bulk:${req.ip}`;
    },
    errorResponseBuilder: (req: any, context: any) => ({
      error: 'Bulk operation rate limit exceeded',
      message: 'Too many bulk operations, please try again later',
      retryAfter: Math.round(context.ttl / 1000)
    })
  }
};

// Redis client for rate limiting
let redisClient: any = null;

export async function createRedisClientForRateLimit() {
  if (!env.REDIS_URL) {
    return null; // Use in-memory store
  }

  try {
    const { createClient } = await import('redis');
    
    if (!redisClient) {
      redisClient = createClient({
        url: env.REDIS_URL,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            const delay = Math.min(retries * 100, 5000);
            console.log(`Redis rate limit client reconnect attempt ${retries}, waiting ${delay}ms`);
            return delay;
          }
        }
      });

      redisClient.on('error', (err: any) => {
        console.error('Redis Rate Limit Client Error:', err);
      });

      redisClient.on('connect', () => {
        console.log('Redis Rate Limit Client Connected');
      });

      await redisClient.connect();
    }

    return redisClient;
  } catch (error) {
    console.warn('Failed to create Redis client for rate limiting, using in-memory store:', error);
    return null;
  }
}

// Redis store configuration for rate limiting
export const rateLimitStoreConfig = {
  // Will be populated with actual Redis client
  redis: null as any
};
