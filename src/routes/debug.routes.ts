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
      logger.warn('🚨 DEBUG: Manual cache clear requested');
      await CacheInvalidation.clearAllApiCache();
      
      return {
        success: true,
        message: "All API cache cleared using nuclear option",
        timestamp: new Date().toISOString(),
        note: "Check server logs for detailed clearing results"
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
        'api_cache:GET:/v1/projects/marketplace',
        'api_cache:GET:/v1/projects/mine'
      ];

      const cacheStatus: Record<string, string> = {};
      for (const key of sampleKeys) {
        try {
          const value = await cache.get(key);
          cacheStatus[key] = value ? `EXISTS (${typeof value})` : 'NOT_FOUND';
        } catch (error) {
          cacheStatus[key] = `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`;
        }
      }

      // Test cache operations
      const testKey = `debug_test_${Date.now()}`;
      const testValue = JSON.stringify({ test: true, timestamp: new Date().toISOString() });
      
      try {
        await cache.set(testKey, testValue, 10);
        const retrieved = await cache.get(testKey);
        await cache.del(testKey);
        
        return {
          success: true,
          cacheType: process.env.NODE_ENV === 'production' && process.env.REDIS_URL ? 'redis' : 'memory',
          redisUrl: process.env.REDIS_URL ? 'configured' : 'not_configured',
          nodeEnv: process.env.NODE_ENV,
          sampleKeys: cacheStatus,
          cacheTest: {
            set: 'SUCCESS',
            get: retrieved ? 'SUCCESS' : 'FAILED',
            delete: 'SUCCESS'
          },
          timestamp: new Date().toISOString()
        };
      } catch (cacheError) {
        return {
          success: false,
          cacheType: process.env.NODE_ENV === 'production' && process.env.REDIS_URL ? 'redis' : 'memory',
          sampleKeys: cacheStatus,
          cacheTest: {
            error: cacheError instanceof Error ? cacheError.message : 'Unknown cache error'
          },
          timestamp: new Date().toISOString()
        };
      }
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
      console.log('🧪 DEBUG: Testing WebSocket emission...');
      
      const { emitProjectUpdate, getConnectionStats, getWebSocketHealth } = await import("../utils/enhancedWebSocket");
      
      // Get WebSocket status first
      const wsHealth = getWebSocketHealth();
      const wsStats = getConnectionStats();
      
      console.log('🔍 WebSocket Health:', wsHealth);
      console.log('📊 WebSocket Stats:', wsStats);
      
      logger.info('WebSocket Status Before Emit: ' + JSON.stringify({ wsHealth, wsStats }));
      
      // Emit a test project update
      console.log('🚀 Emitting test WebSocket event...');
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

      console.log('✅ WebSocket event emission completed');
      logger.info('WebSocket event emitted successfully');

      return {
        success: true,
        message: "Test WebSocket event emitted",
        eventType: 'project-updated',
        projectId: 'test-project-123',
        webSocketHealth: wsHealth,
        connectionStats: wsStats,
        timestamp: new Date().toISOString(),
        note: "Check server console for detailed WebSocket logs"
      };
    } catch (error) {
      console.error('❌ WebSocket test failed:', error);
      logger.error({ error }, 'Failed to emit test WebSocket event');
      return reply.status(500).send({
        success: false,
        error: "Failed to emit test WebSocket event",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Debug cache key generation
  app.post("/debug/cache-keys", async (request, reply) => {
    try {
      const { url, method = 'GET', headers = {} } = request.body as any;
      
      if (!url) {
        return reply.status(400).send({
          success: false,
          error: "URL is required"
        });
      }

      // Simulate cache key generation
      const mockRequest = {
        url,
        method,
        headers: {
          'user-agent': 'debug-test',
          'authorization': 'Bearer test-token',
          ...headers
        }
      } as any;

      // Generate keys using different patterns
      const keys = {
        // Default API cache key
        apiCache: `api_cache:${method}:${url}`,
        
        // College projects pattern
        collegeProjects: `college_projects:${Buffer.from(url).toString('base64')}`,
        
        // Faculty projects pattern (would need user ID)
        facultyProjects: `faculty_projects:user:test-user:${Buffer.from(url).toString('base64')}`,
        
        // Marketplace pattern (would need college ID)
        marketplace: `marketplace:college:test-college:${Buffer.from(url).toString('base64')}`,
        
        // With vary headers
        withVaryHeaders: (() => {
          const varyValues = ['authorization', 'user-agent'].map(header => {
            const value = mockRequest.headers[header.toLowerCase()];
            return `${header}:${value || 'none'}`;
          }).join('|');
          return `api_cache:${method}:${url}:${Buffer.from(varyValues).toString('base64')}`;
        })()
      };

      return {
        success: true,
        url,
        method,
        generatedKeys: keys,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error({ error }, 'Failed to generate cache keys');
      return reply.status(500).send({
        success: false,
        error: "Failed to generate cache keys",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Debug actual request cache key
  app.get("/debug/request-cache-key", async (request, reply) => {
    try {
      // This endpoint shows what cache key would be generated for this request
      const url = request.url;
      const method = request.method;
      
      const keys = {
        thisRequest: `api_cache:${method}:${url}`,
        projectsList: `api_cache:GET:/v1/projects`,
        facultyProjects: `api_cache:GET:/v1/projects/mine`,
        marketplace: `api_cache:GET:/v1/projects/marketplace`
      };

      return {
        success: true,
        currentRequest: {
          url,
          method,
          headers: Object.keys(request.headers)
        },
        possibleCacheKeys: keys,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: "Failed to analyze request",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Check WebSocket server status
  app.get("/debug/websocket-status", async (request, reply) => {
    try {
      const { getWebSocketInstance, getWebSocketHealth, getConnectionStats } = await import("../utils/enhancedWebSocket");
      
      const wsInstance = getWebSocketInstance();
      const wsHealth = getWebSocketHealth();
      const wsStats = getConnectionStats();

      // Get detailed room information
      const roomDetails: { [room: string]: string[] } = {};
      if (wsInstance) {
        wsInstance.sockets.adapter.rooms.forEach((sockets, room) => {
          // Skip socket ID rooms (they start with socket ID pattern)
          if (!room.includes('-') || room.includes(':')) {
            roomDetails[room] = Array.from(sockets);
          }
        });
      }

      return {
        success: true,
        websocketInitialized: !!wsInstance,
        health: wsHealth,
        stats: wsStats,
        roomDetails,
        serverInfo: {
          port: process.env.PORT || 4003,
          nodeEnv: process.env.NODE_ENV,
          uptime: process.uptime()
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: "Failed to get WebSocket status",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  logger.info('Debug routes enabled for development');
}
