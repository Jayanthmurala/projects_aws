import { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { getCache } from "../utils/cache";
import { getWebSocketHealth, getConnectionStats } from "../utils/enhancedWebSocket";
import { env } from "../config/env";

export default async function healthRoutes(app: FastifyInstance) {
  
  // Basic liveness probe
  app.get("/health", async (request, reply) => {
    return {
      status: "ok",
      service: "projects-service",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || "unknown"
    };
  });

  // Comprehensive readiness probe
  app.get("/health/ready", async (request, reply) => {
    const checks: any = {
      timestamp: new Date().toISOString(),
      service: "projects-service",
      status: "healthy",
      checks: {}
    };

    let overallHealthy = true;

    // Database connectivity check
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.checks.database = {
        status: "healthy",
        message: "Database connection successful"
      };
    } catch (error) {
      overallHealthy = false;
      checks.checks.database = {
        status: "unhealthy",
        message: "Database connection failed",
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }

    // Redis cache check
    try {
      const cache = getCache();
      await cache.set("health_check", "ok", 10);
      const result = await cache.get("health_check");
      
      if (result === "ok") {
        checks.checks.cache = {
          status: "healthy",
          message: "Cache connection successful"
        };
      } else {
        throw new Error("Cache test failed");
      }
    } catch (error) {
      // Cache is not critical, so don't fail overall health
      checks.checks.cache = {
        status: "degraded",
        message: "Cache connection issues",
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }

    // WebSocket health check
    try {
      const wsHealth = getWebSocketHealth();
      checks.checks.websocket = {
        status: wsHealth.status,
        connections: wsHealth.connections,
        uptime: wsHealth.uptime,
        ...(wsHealth.lastError && { error: wsHealth.lastError })
      };
      
      if (wsHealth.status !== 'healthy') {
        overallHealthy = false;
      }
    } catch (error) {
      overallHealthy = false;
      checks.checks.websocket = {
        status: "unhealthy",
        message: "WebSocket health check failed",
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }

    // External service checks (Auth service)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const authResponse = await fetch(`${env.AUTH_BASE_URL}/health`, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (authResponse.ok) {
        checks.checks.authService = {
          status: "healthy",
          message: "Auth service accessible"
        };
      } else {
        throw new Error(`Auth service returned ${authResponse.status}`);
      }
    } catch (error) {
      // External services are not critical for basic functionality
      checks.checks.authService = {
        status: "degraded",
        message: "Auth service connection issues",
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }

    // Memory usage check
    const memUsage = process.memoryUsage();
    const memUsageMB = {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    };

    // Consider unhealthy if using more than 1GB RSS
    const memoryHealthy = memUsageMB.rss < 1024;
    if (!memoryHealthy) {
      overallHealthy = false;
    }

    checks.checks.memory = {
      status: memoryHealthy ? "healthy" : "unhealthy",
      usage: memUsageMB,
      message: memoryHealthy ? "Memory usage normal" : "High memory usage detected"
    };

    // Set overall status
    checks.status = overallHealthy ? "healthy" : "unhealthy";

    // Return appropriate HTTP status
    const statusCode = overallHealthy ? 200 : 503;
    return reply.status(statusCode).send(checks);
  });

  // Detailed metrics endpoint (secured)
  app.get("/health/metrics", async (request, reply) => {
    // Require internal API key for metrics access
    const authHeader = request.headers['x-internal-key'] as string;
    if (!authHeader || authHeader !== env.INTERNAL_API_KEY) {
      return reply.status(401).send({ 
        error: 'Unauthorized',
        message: 'Internal API key required for metrics access'
      });
    }

    const metrics = {
      timestamp: new Date().toISOString(),
      service: "projects-service",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      
      // WebSocket metrics
      websocket: getConnectionStats(),
      
      // Process metrics
      process: {
        pid: process.pid,
        version: process.version,
        platform: process.platform,
        arch: process.arch
      },
      
      // Environment info (non-sensitive)
      environment: {
        nodeEnv: env.NODE_ENV,
        port: env.PORT,
        // Don't expose sensitive config
      }
    };

    return metrics;
  });

  // Database-specific health check
  app.get("/health/database", async (request, reply) => {
    try {
      // Test basic connectivity
      await prisma.$queryRaw`SELECT 1`;
      
      // Test table access
      const projectCount = await prisma.project.count();
      const applicationCount = await prisma.appliedProject.count();
      
      // Test write capability (create and delete a test record)
      const testRecord = await prisma.project.create({
        data: {
          id: `health_check_${Date.now()}`,
          collegeId: "health_check",
          authorId: "health_check",
          authorName: "Health Check",
          title: "Health Check Project",
          description: "This is a health check project",
          projectType: "OTHER",
          moderationStatus: "PENDING_APPROVAL",
          progressStatus: "OPEN",
          maxStudents: 1,
          skills: [],
          departments: [],
          tags: [],
          requirements: [],
          outcomes: []
        }
      });
      
      // Clean up test record
      await prisma.project.delete({
        where: { id: testRecord.id }
      });

      return {
        status: "healthy",
        message: "Database fully operational",
        stats: {
          projects: projectCount,
          applications: applicationCount
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return reply.status(503).send({
        status: "unhealthy",
        message: "Database connectivity issues",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString()
      });
    }
  });

  // Cache health check
  app.get("/health/cache", async (request, reply) => {
    try {
      const cache = getCache();
      const testKey = `health_check_${Date.now()}`;
      const testValue = "health_check_value";
      
      // Test write
      await cache.set(testKey, testValue, 10);
      
      // Test read
      const result = await cache.get(testKey);
      
      // Test delete
      await cache.del(testKey);
      
      if (result === testValue) {
        return {
          status: "healthy",
          message: "Cache fully operational",
          timestamp: new Date().toISOString()
        };
      } else {
        throw new Error("Cache test failed - value mismatch");
      }
    } catch (error) {
      return reply.status(503).send({
        status: "unhealthy",
        message: "Cache connectivity issues",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString()
      });
    }
  });
}
