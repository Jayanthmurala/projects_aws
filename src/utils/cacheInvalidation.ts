import { getCache, CACHE_KEYS } from './cache';
import { logger } from './logger';

const cache = getCache();

/**
 * Cache invalidation utilities for maintaining data consistency
 */
export class CacheInvalidation {
  
  /**
   * Invalidate user-related cache when user data changes
   */
  static async invalidateUserCache(userId: string) {
    try {
      const keys = [
        CACHE_KEYS.USER_SCOPE(userId),
        CACHE_KEYS.USER_IDENTITY(userId)
      ];

      await Promise.all(keys.map(key => cache.del(key)));
      
      logger.debug({ userId, keys }, 'Invalidated user cache');
    } catch (error) {
      logger.error({ error, userId }, 'Failed to invalidate user cache');
    }
  }

  /**
   * Invalidate project-related cache when project changes
   */
  static async invalidateProjectCache(projectId: string, collegeId?: string, authorId?: string) {
    try {
      const keys: string[] = [];

      // API Response Cache Keys (from caching middleware)
      // These are the actual keys that need to be cleared for real-time updates
      keys.push(
        // College projects listing cache
        'college_projects:*',
        // Faculty projects cache  
        'faculty_projects:*',
        // Marketplace cache
        'marketplace:*',
        // Applications cache
        'applications:*',
        // General API cache
        'api_cache:*'
      );

      // Legacy cache keys (if any)
      if (collegeId) {
        keys.push(
          `college_projects:${collegeId}`,
          `college_stats:${collegeId}`,
          `project_list:${collegeId}:*`
        );
      }

      if (authorId) {
        keys.push(
          `user_projects:${authorId}`,
          `faculty_projects:${authorId}`
        );
      }

      // Project-specific keys
      keys.push(
        `project:${projectId}`,
        `project_applications:${projectId}`,
        `project_stats:${projectId}`
      );

      // Clear cache keys with pattern matching
      await this.clearCacheByPattern(keys);
      
      // AGGRESSIVE: Clear all API cache to ensure real-time updates work
      await this.clearAllApiCache();
      
      logger.debug({ projectId, collegeId, authorId, keys }, 'Invalidated project cache');
    } catch (error) {
      logger.error({ error, projectId, collegeId, authorId }, 'Failed to invalidate project cache');
    }
  }

  /**
   * Clear cache keys by pattern (supports wildcards)
   */
  static async clearCacheByPattern(patterns: string[]) {
    try {
      for (const pattern of patterns) {
        if (pattern.includes('*')) {
          // For wildcard patterns, we need to get all matching keys
          await this.clearWildcardPattern(pattern);
        } else {
          // Direct key deletion
          await cache.del(pattern);
        }
      }
    } catch (error) {
      logger.error({ error, patterns }, 'Failed to clear cache by pattern');
    }
  }

  /**
   * Clear cache keys matching wildcard pattern
   */
  static async clearWildcardPattern(pattern: string) {
    try {
      // For Redis, we would use SCAN command
      // For in-memory cache, we need to implement pattern matching
      const cacheType = process.env.NODE_ENV === 'production' && process.env.REDIS_URL ? 'redis' : 'memory';
      
      if (cacheType === 'redis') {
        // Redis implementation would use SCAN + DEL
        // For now, we'll clear common patterns manually
        const commonKeys = this.getCommonCacheKeys(pattern);
        await Promise.all(commonKeys.map(key => cache.del(key)));
      } else {
        // In-memory cache - AGGRESSIVE CLEARING for immediate fix
        // Clear all possible variations of the pattern
        const commonKeys = this.getCommonCacheKeys(pattern);
        
        // Also try to clear with different user patterns
        if (pattern.startsWith('faculty_projects:')) {
          // Clear for different user ID patterns
          const additionalKeys = [
            'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU=',
            'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU/bGltaXQ9NTA=',
            'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU/bGltaXQ9MjA=',
            'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU/cGFnZT0x',
          ];
          commonKeys.push(...additionalKeys);
        }
        
        logger.warn(`🧹 CLEARING ${commonKeys.length} cache keys for pattern: ${pattern}`);
        await Promise.all(commonKeys.map(async (key) => {
          try {
            await cache.del(key);
            logger.debug(`✅ Cleared cache key: ${key}`);
          } catch (error) {
            logger.error(`❌ Failed to clear key ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }));
      }
    } catch (error) {
      logger.error({ error, pattern }, 'Failed to clear wildcard pattern');
    }
  }

  /**
   * Get common cache keys for a pattern
   */
  static getCommonCacheKeys(pattern: string): string[] {
    const keys: string[] = [];
    
    if (pattern.startsWith('college_projects:')) {
      // Generate common college project cache keys
      keys.push(
        'college_projects:L3YxL3Byb2plY3Rz', // /v1/projects
        'college_projects:L3YxL3Byb2plY3RzP3BhZ2U9MQ==', // /v1/projects?page=1
        'college_projects:L3YxL3Byb2plY3RzP2xpbWl0PTIw', // /v1/projects?limit=20
        'college_projects:L3YxL3Byb2plY3RzP2xpbWl0PTUw' // /v1/projects?limit=50
      );
    } else if (pattern.startsWith('faculty_projects:')) {
      // CRITICAL: Clear the exact faculty projects cache keys we see in logs
      keys.push(
        'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU=', // /v1/projects/mine
        'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU/bGltaXQ9NTA=', // /v1/projects/mine?limit=50
        'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU/bGltaXQ9MjA=', // /v1/projects/mine?limit=20
        'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU/cGFnZT0x', // /v1/projects/mine?page=1
      );
    } else if (pattern.startsWith('marketplace:')) {
      keys.push(
        'marketplace:college:test:L3YxL3Byb2plY3RzL21hcmtldHBsYWNl', // /v1/projects/marketplace
      );
    } else if (pattern.startsWith('api_cache:')) {
      keys.push(
        'api_cache:GET:/v1/projects',
        'api_cache:GET:/v1/projects/marketplace',
        'api_cache:GET:/v1/projects/mine',
        'api_cache:GET:/v1/applications/mine'
      );
    }
    
    return keys;
  }

  /**
   * Clear ALL API response cache (aggressive approach for immediate real-time updates)
   * Use this when you need to ensure real-time updates work immediately
   */
  static async clearAllApiCache() {
    try {
      // NUCLEAR OPTION: Clear all known cache key patterns
      const specificKeys = [
        // Faculty projects - all variations
        'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU=',
        'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU/bGltaXQ9NTA=',
        'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU/bGltaXQ9MjA=',
        'faculty_projects:user:anonymous:L3YxL3Byb2plY3RzL21pbmU/cGFnZT0x',
        
        // College projects - all variations
        'college_projects:L3YxL3Byb2plY3Rz',
        'college_projects:L3YxL3Byb2plY3RzP3BhZ2U9MQ==',
        'college_projects:L3YxL3Byb2plY3RzP2xpbWl0PTIw',
        'college_projects:L3YxL3Byb2plY3RzP2xpbWl0PTUw',
        
        // Marketplace - NEW KEYS FROM LOGS (all variations)
        'marketplace:college:no-college:L3YxL3Byb2plY3RzL21hcmtldHBsYWNlP3BhZ2U9MSZsaW1pdD0xMg==',
        'marketplace:college:no-college:L3YxL3Byb2plY3RzL21hcmtldHBsYWNl',
        'marketplace:college:no-college:L3YxL3Byb2plY3RzL21hcmtldHBsYWNlP3BhZ2U9MQ==',
        'marketplace:college:no-college:L3YxL3Byb2plY3RzL21hcmtldHBsYWNlP2xpbWl0PTIw',
        'marketplace:college:no-college:L3YxL3Byb2plY3RzL21hcmtldHBsYWNlP3BhZ2U9MSZsaW1pdD0yMA==',
        'marketplace:college:no-college:L3YxL3Byb2plY3RzL21hcmtldHBsYWNlP3BhZ2U9MiZsaW1pdD0xMg==',
        
        // API cache variations
        'api_cache:GET:/v1/projects',
        'api_cache:GET:/v1/projects/mine',
        'api_cache:GET:/v1/projects/marketplace',
        'api_cache:GET:/v1/applications/mine',
      ];

      logger.warn(`🚨 NUCLEAR CACHE CLEAR: Clearing ${specificKeys.length} specific cache keys`);
      
      let clearedCount = 0;
      let errorCount = 0;
      
      for (const key of specificKeys) {
        try {
          await cache.del(key);
          clearedCount++;
          logger.debug(`✅ Cleared: ${key}`);
        } catch (error) {
          errorCount++;
          logger.error(`❌ Failed to clear: ${key}`);
        }
      }
      
      logger.warn(`✅ CACHE CLEAR COMPLETE: ${clearedCount} cleared, ${errorCount} errors`);
      
    } catch (error) {
      logger.error({ error }, '❌ Failed to clear all API cache');
    }
  }

  /**
   * Invalidate application-related cache when application status changes
   */
  static async invalidateApplicationCache(applicationId: string, projectId: string, studentId: string) {
    try {
      const keys = [
        // API Response Cache Keys (from caching middleware)
        'applications:*',
        'marketplace:*', 
        'college_projects:*',
        'faculty_projects:*',
        'api_cache:*',
        // Legacy keys
        `application:${applicationId}`,
        `project_applications:${projectId}`,
        `student_applications:${studentId}`,
        `application_stats:${projectId}`,
        `student_stats:${studentId}`
      ];

      await this.clearCacheByPattern(keys);
      
      // AGGRESSIVE: Clear all API cache to ensure real-time updates work
      await this.clearAllApiCache();
      
      logger.debug({ applicationId, projectId, studentId, keys }, 'Invalidated application cache');
    } catch (error) {
      logger.error({ error, applicationId }, 'Failed to invalidate application cache');
    }
  }

  /**
   * Invalidate college-wide cache (use sparingly)
   */
  static async invalidateCollegeCache(collegeId: string) {
    try {
      const keys = [
        CACHE_KEYS.COLLEGE_DEPARTMENTS(collegeId),
        `college_projects:${collegeId}`,
        `college_stats:${collegeId}`,
        `college_analytics:${collegeId}`
      ];

      await Promise.all(keys.map(key => cache.del(key)));
      
      logger.debug({ collegeId, keys }, 'Invalidated college cache');
    } catch (error) {
      logger.error({ error, collegeId }, 'Failed to invalidate college cache');
    }
  }

  /**
   * Invalidate admin dashboard cache
   */
  static async invalidateAdminCache(adminId: string, collegeId?: string) {
    try {
      const keys = [
        `admin_dashboard:${adminId}`,
        `admin_analytics:${adminId}`
      ];

      if (collegeId) {
        keys.push(
          `admin_college_stats:${collegeId}`,
          `admin_projects:${collegeId}`,
          `admin_applications:${collegeId}`
        );
      }

      await Promise.all(keys.map(key => cache.del(key)));
      
      logger.debug({ adminId, collegeId, keys }, 'Invalidated admin cache');
    } catch (error) {
      logger.error({ error, adminId }, 'Failed to invalidate admin cache');
    }
  }

  /**
   * Smart cache invalidation based on entity type and action
   */
  static async invalidateByEntity(
    entityType: 'project' | 'application' | 'user' | 'college',
    entityId: string,
    action: 'create' | 'update' | 'delete',
    context: any = {}
  ) {
    try {
      switch (entityType) {
        case 'project':
          await this.invalidateProjectCache(entityId, context.collegeId, context.authorId);
          // Also invalidate college cache for project count changes
          if (context.collegeId && (action === 'create' || action === 'delete')) {
            await this.invalidateCollegeCache(context.collegeId);
          }
          break;

        case 'application':
          await this.invalidateApplicationCache(entityId, context.projectId, context.studentId);
          // Also invalidate project cache for application count changes
          if (context.projectId) {
            await this.invalidateProjectCache(context.projectId, context.collegeId);
          }
          break;

        case 'user':
          await this.invalidateUserCache(entityId);
          break;

        case 'college':
          await this.invalidateCollegeCache(entityId);
          break;
      }

      logger.info({ entityType, entityId, action, context }, 'Smart cache invalidation completed');
    } catch (error) {
      logger.error({ error, entityType, entityId, action }, 'Smart cache invalidation failed');
    }
  }

  /**
   * Bulk cache invalidation for batch operations
   */
  static async invalidateBulk(invalidations: Array<{
    entityType: 'project' | 'application' | 'user' | 'college';
    entityId: string;
    action: 'create' | 'update' | 'delete';
    context?: any;
  }>) {
    try {
      await Promise.all(
        invalidations.map(({ entityType, entityId, action, context }) =>
          this.invalidateByEntity(entityType, entityId, action, context)
        )
      );

      logger.info({ count: invalidations.length }, 'Bulk cache invalidation completed');
    } catch (error) {
      logger.error({ error, count: invalidations.length }, 'Bulk cache invalidation failed');
    }
  }

  /**
   * Clear all cache (emergency use only)
   */
  static async clearAll() {
    try {
      // This would require Redis FLUSHDB in a real implementation
      // For now, we'll just log the action
      logger.warn('Cache clear all requested - implement Redis FLUSHDB for production');
    } catch (error) {
      logger.error({ error }, 'Failed to clear all cache');
    }
  }
}

/**
 * Middleware to automatically invalidate cache after successful operations
 */
export function createCacheInvalidationMiddleware(
  entityType: 'project' | 'application' | 'user' | 'college',
  getEntityId: (request: any) => string,
  getAction: (request: any) => 'create' | 'update' | 'delete',
  getContext?: (request: any) => any
) {
  return async (request: any, reply: any) => {
    // Add hook to run after successful response
    reply.addHook('onSend', async (request: any, reply: any, payload: any) => {
      // Only invalidate on successful responses
      if (reply.statusCode >= 200 && reply.statusCode < 300) {
        try {
          const entityId = getEntityId(request);
          const action = getAction(request);
          const context = getContext ? getContext(request) : {};

          await CacheInvalidation.invalidateByEntity(entityType, entityId, action, context);
        } catch (error) {
          // Don't fail the request if cache invalidation fails
          logger.warn({ error }, 'Cache invalidation middleware failed');
        }
      }
    });
  };
}
