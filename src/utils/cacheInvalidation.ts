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

      // Add college-specific cache keys if available
      if (collegeId) {
        keys.push(
          `college_projects:${collegeId}`,
          `college_stats:${collegeId}`,
          `project_list:${collegeId}:*` // Pattern for wildcard deletion
        );
      }

      // Add author-specific cache keys if available
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

      await Promise.all(keys.map(key => {
        if (key.includes('*')) {
          // Handle wildcard patterns (would need Redis SCAN in real implementation)
          return Promise.resolve();
        }
        return cache.del(key);
      }));
      
      logger.debug({ projectId, collegeId, authorId, keys }, 'Invalidated project cache');
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to invalidate project cache');
    }
  }

  /**
   * Invalidate application-related cache when application status changes
   */
  static async invalidateApplicationCache(applicationId: string, projectId: string, studentId: string) {
    try {
      const keys = [
        `application:${applicationId}`,
        `project_applications:${projectId}`,
        `student_applications:${studentId}`,
        `application_stats:${projectId}`,
        `student_stats:${studentId}`
      ];

      await Promise.all(keys.map(key => cache.del(key)));
      
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
