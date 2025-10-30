import { FastifyInstance } from "fastify";
import { CacheInvalidation } from "../utils/cacheInvalidation";
import { getCache } from "../utils/cache";
import { logger } from "../utils/logger";

export default async function debugRoutes(app: FastifyInstance) {
  
  // Only enable debug routes in development
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  // Clear all API cache (for testing real-time updates)
  app.post("/debug/clear-cache", async (request, reply) => {
    try {
      await CacheInvalidation.clearAllApiCache();
      
      return {
        success: true,
        message: "All API cache cleared",
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error({ error }, 'Failed to clear cache via debug endpoint');
      return reply.status(500).send({
        success: false,
        error: "Failed to clear cache",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get cache stats
  app.get("/debug/cache-stats", async (request, reply) => {
    try {
      const cache = getCache();
      
      // Try to get some sample cache keys to see what's stored
      const sampleKeys = [
        'college_projects:L3YxL3Byb2plY3Rz',
        'faculty_projects:user:test:L3YxL3Byb2plY3RzL21pbmU=',
        'marketplace:college:test:L3YxL3Byb2plY3RzL21hcmtldHBsYWNl',
        'api_cache:GET:/v1/projects',
        'api_cache:GET:/v1/projects/marketplace'
      ];

      const cacheStatus: Record<string, string> = {};
      for (const key of sampleKeys) {
        try {
          const value = await cache.get(key);
          cacheStatus[key] = value ? 'EXISTS' : 'NOT_FOUND';
        } catch (error) {
          cacheStatus[key] = 'ERROR';
        }
      }

      return {
        success: true,
        cacheType: process.env.NODE_ENV === 'production' && process.env.REDIS_URL ? 'redis' : 'memory',
        redisUrl: process.env.REDIS_URL ? 'configured' : 'not_configured',
        sampleKeys: cacheStatus,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get cache stats');
      return reply.status(500).send({
        success: false,
        error: "Failed to get cache stats",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Test cache invalidation for a specific project
  app.post("/debug/invalidate-project/:projectId", async (request, reply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      
      await CacheInvalidation.invalidateByEntity('project', projectId, 'update', {
        collegeId: 'test-college',
        authorId: 'test-author'
      });

      return {
        success: true,
        message: `Cache invalidated for project ${projectId}`,
        projectId,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error({ error }, 'Failed to invalidate project cache');
      return reply.status(500).send({
        success: false,
        error: "Failed to invalidate project cache",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Test WebSocket emission
  app.post("/debug/test-websocket", async (request, reply) => {
    try {
      const { emitProjectUpdate } = await import("../utils/enhancedWebSocket");
      
      // Emit a test project update
      emitProjectUpdate({
        type: 'project-updated',
        projectId: 'test-project-123',
        project: {
          id: 'test-project-123',
          title: 'Test Project for WebSocket',
          description: 'Testing WebSocket functionality'
        },
        collegeId: 'test-college',
        departments: ['Computer Science'],
        visibleToAllDepts: true,
        updatedBy: { id: 'debug-user', name: 'Debug User' },
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        message: "Test WebSocket event emitted",
        eventType: 'project-updated',
        projectId: 'test-project-123',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error({ error }, 'Failed to emit test WebSocket event');
      return reply.status(500).send({
        success: false,
        error: "Failed to emit test WebSocket event",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  logger.info('Debug routes enabled for development');
}
