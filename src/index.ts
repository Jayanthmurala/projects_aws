import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
// Removed Zod type provider - using standard JSON Schema validation
import { adminRoutes } from "./admin/routes/index";
import publicRoutes from "./routes/public.routes";
import facultyRoutes from "./routes/faculty.routes";
import studentRoutes from "./routes/student.routes";
import collaborationRoutes from "./routes/collaboration.routes";
import projectsRoutes from "./routes/projects.routes";
import healthRoutes from "./routes/health.routes";
import debugRoutes from "./routes/debug.routes";
import { env } from "./config/env";
import { rateLimitConfig, createRedisClientForRateLimit } from "./config/rateLimits";
import { initializeWebSocket } from "./utils/enhancedWebSocket";
import { errorHandler, notFoundHandler, setupGracefulShutdown } from "./middlewares/errorHandler";
import { responseFormatterPlugin } from "./middlewares/responseFormatter";
import { createRequestLoggingMiddleware } from "./utils/logger";
import { createSecurityHeadersMiddleware, createRequestSanitizationMiddleware } from "./middlewares/securityHeaders";

async function buildServer() {
  const app = Fastify({ logger: true });

  // Using standard Fastify JSON Schema validation

  await app.register(cors, {
    origin: ["http://localhost:3000", "http://127.0.0.1:3000", "https://nexus-frontend-pi-ten.vercel.app"],
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Register rate limiting for security (using in-memory store for compatibility)
  // Note: Redis integration disabled due to @fastify/rate-limit v9.1.0 compatibility issues
  // In production, consider using external rate limiting (nginx, API gateway, etc.)
  await app.register(rateLimit, {
    ...rateLimitConfig.general,
    nameSpace: 'nexus-projects-rl:',
    continueExceeding: true,
    allowList: ['127.0.0.1', '::1'], // Allow localhost in development
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true
    },
    // Use in-memory store for now (works in single-instance deployments)
    // For multi-instance deployments, use external rate limiting
    skipOnError: true
  });

  // Register security middleware (enterprise compliance)
  app.addHook('preHandler', createSecurityHeadersMiddleware());
  app.addHook('preHandler', createRequestSanitizationMiddleware());

  // Register response formatter plugin
  await app.register(responseFormatterPlugin);

  // Register request logging middleware
  app.addHook('preHandler', createRequestLoggingMiddleware());
  
  // Register response logging hook
  app.addHook('onResponse', async (request: any, reply: any) => {
    if (request.requestLogger && request.startTime) {
      const duration = Date.now() - request.startTime;
      const responseSize = reply.getHeader('content-length') || 0;
      
      request.requestLogger.info({
        statusCode: reply.statusCode,
        duration,
        responseSize,
        method: request.method,
        url: request.url
      }, 'Request completed');
    }
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Nexus Projects Service API",
        description: "API for managing projects, applications, and collaboration",
        version: "1.0.0",
        contact: {
          name: "Nexus Development Team",
          email: "dev@nexus.edu"
        },
        license: {
          name: "MIT",
          url: "https://opensource.org/licenses/MIT"
        }
      },
      servers: [
        {
          url: "http://localhost:3001",
          description: "Development server",
        },
        {
          url: "https://api.nexus.edu/projects",
          description: "Production server",
        }
      ],
      tags: [
        { name: "projects", description: "Projects endpoints" },
        { name: "applications", description: "Applications endpoints" },
        { name: "tasks", description: "Tasks endpoints" },
        { name: "attachments", description: "Attachments endpoints" },
        { name: "comments", description: "Comments endpoints" },
        { name: "admin", description: "Head Admin endpoints" },
        { name: "head-admin", description: "HEAD_ADMIN project management endpoints" },
        { name: "dept-admin", description: "DEPT_ADMIN project management endpoints" },
        { name: "placements-admin", description: "PLACEMENTS_ADMIN project management endpoints" },
      ],
    },
    // Using standard JSON Schema transform
  });
  await app.register(swaggerUI, { routePrefix: "/docs" });

  // Register error handlers
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  app.get("/", async () => ({ message: "Nexus Projects Service" }));

  // Register routes
  await app.register(healthRoutes);
  await app.register(publicRoutes);
  await app.register(projectsRoutes);
  await app.register(facultyRoutes);
  await app.register(studentRoutes);
  await app.register(collaborationRoutes);
  await app.register(adminRoutes);
  await app.register(debugRoutes);

  return app;
}

buildServer()
  .then((app) => {
    // Setup graceful shutdown
    setupGracefulShutdown(app);
    
    return app.listen({ port: env.PORT, host: "0.0.0.0" }).then((address) => {
      console.log(`Projects service listening at ${address}`);
      
      // Initialize enhanced WebSocket after server starts
      const server = app.server;
      initializeWebSocket(server);
      console.log("Enhanced WebSocket initialized for real-time project updates");
      
      return address;
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
