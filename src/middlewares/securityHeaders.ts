import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env';

/**
 * Enterprise Security Headers Middleware
 * Implements OWASP security best practices and compliance requirements
 */

export interface SecurityConfig {
  contentSecurityPolicy?: string;
  strictTransportSecurity?: string;
  xFrameOptions?: string;
  xContentTypeOptions?: string;
  referrerPolicy?: string;
  permissionsPolicy?: string;
}

const defaultSecurityConfig: SecurityConfig = {
  // Content Security Policy - strict by default
  contentSecurityPolicy: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // Allow inline scripts for development
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '),

  // HTTP Strict Transport Security - 1 year with includeSubDomains
  strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',

  // X-Frame-Options - prevent clickjacking
  xFrameOptions: 'DENY',

  // X-Content-Type-Options - prevent MIME sniffing
  xContentTypeOptions: 'nosniff',

  // Referrer Policy - strict origin when cross-origin
  referrerPolicy: 'strict-origin-when-cross-origin',

  // Permissions Policy - restrict dangerous features
  permissionsPolicy: [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
    'magnetometer=()',
    'gyroscope=()',
    'accelerometer=()'
  ].join(', ')
};

/**
 * Security headers middleware factory
 */
export function createSecurityHeadersMiddleware(config: SecurityConfig = {}) {
  const finalConfig = { ...defaultSecurityConfig, ...config };

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Content Security Policy
    if (finalConfig.contentSecurityPolicy) {
      reply.header('Content-Security-Policy', finalConfig.contentSecurityPolicy);
    }

    // HTTP Strict Transport Security (only in production with HTTPS)
    if (env.NODE_ENV === 'production' && finalConfig.strictTransportSecurity) {
      reply.header('Strict-Transport-Security', finalConfig.strictTransportSecurity);
    }

    // X-Frame-Options
    if (finalConfig.xFrameOptions) {
      reply.header('X-Frame-Options', finalConfig.xFrameOptions);
    }

    // X-Content-Type-Options
    if (finalConfig.xContentTypeOptions) {
      reply.header('X-Content-Type-Options', finalConfig.xContentTypeOptions);
    }

    // Referrer Policy
    if (finalConfig.referrerPolicy) {
      reply.header('Referrer-Policy', finalConfig.referrerPolicy);
    }

    // Permissions Policy
    if (finalConfig.permissionsPolicy) {
      reply.header('Permissions-Policy', finalConfig.permissionsPolicy);
    }

    // Additional security headers
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('X-DNS-Prefetch-Control', 'off');
    reply.header('X-Download-Options', 'noopen');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');

    // Remove server information
    reply.removeHeader('Server');
    reply.removeHeader('X-Powered-By');

    // Cache control for sensitive endpoints
    if (request.url.includes('/admin') || request.url.includes('/auth')) {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
    }
  };
}

/**
 * CORS security middleware with enterprise settings
 */
export function createSecureCorsMiddleware() {
  const allowedOrigins = env.NODE_ENV === 'production' 
    ? [
        'https://nexus.edu',
        'https://app.nexus.edu',
        'https://admin.nexus.edu'
      ]
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'https://nexus-frontend-pi-ten.vercel.app'
      ];

  return {
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // Log unauthorized origin attempts
      console.warn(`CORS: Blocked request from unauthorized origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Requested-With',
      'X-Correlation-ID',
      'X-API-Version'
    ],
    exposedHeaders: [
      'X-Correlation-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset'
    ],
    maxAge: 86400 // 24 hours
  };
}

/**
 * Request sanitization middleware
 */
export function createRequestSanitizationMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Sanitize query parameters
    if (request.query && typeof request.query === 'object') {
      for (const [key, value] of Object.entries(request.query)) {
        if (typeof value === 'string') {
          // Remove potentially dangerous characters
          (request.query as any)[key] = value
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '');
        }
      }
    }

    // Add security context to request
    (request as any).security = {
      correlationId: request.headers['x-correlation-id'] || 'unknown',
      userAgent: request.headers['user-agent'] || 'unknown',
      ip: request.ip,
      timestamp: new Date().toISOString()
    };
  };
}

/**
 * Rate limiting bypass for health checks
 */
export function isHealthCheckEndpoint(url: string): boolean {
  const healthEndpoints = [
    '/health',
    '/health/ready',
    '/health/live',
    '/metrics',
    '/ping'
  ];
  
  return healthEndpoints.some(endpoint => url.startsWith(endpoint));
}

/**
 * Security audit logging
 */
export function logSecurityEvent(
  event: string,
  request: FastifyRequest,
  details: Record<string, any> = {}
) {
  const securityLog = {
    timestamp: new Date().toISOString(),
    event,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    url: request.url,
    method: request.method,
    correlationId: (request as any).correlationId,
    ...details
  };

  // In production, send to security monitoring system
  if (env.NODE_ENV === 'production') {
    // TODO: Integrate with SIEM system (Splunk, ELK, etc.)
    console.warn('[SECURITY]', JSON.stringify(securityLog));
  } else {
    console.warn('[SECURITY]', securityLog);
  }
}

export default {
  createSecurityHeadersMiddleware,
  createSecureCorsMiddleware,
  createRequestSanitizationMiddleware,
  isHealthCheckEndpoint,
  logSecurityEvent
};
