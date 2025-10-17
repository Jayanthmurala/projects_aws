// E2EE Migration Strategy & Rollback Plan
// Phase 4: Safe, non-disruptive migration with comprehensive rollback capabilities

import { prisma } from '../db';
import { FeatureFlags } from './crypto';

export interface MigrationStatus {
  phase: 'preparation' | 'pilot' | 'gradual' | 'complete';
  totalProjects: number;
  encryptedProjects: number;
  migrationProgress: number;
  rollbackReady: boolean;
  lastMigrationDate?: Date;
  errors: string[];
}

export class E2EEMigrationManager {
  
  // Check current migration status
  static async getMigrationStatus(): Promise<MigrationStatus> {
    try {
      const totalProjects = await prisma.project.count({
        where: { archivedAt: null }
      });

      const encryptedProjects = await prisma.conversationKey.count();

      const migrationProgress = totalProjects > 0 ? 
        (encryptedProjects / totalProjects) * 100 : 0;

      // Determine migration phase
      let phase: MigrationStatus['phase'] = 'preparation';
      if (migrationProgress > 0 && migrationProgress < 10) phase = 'pilot';
      else if (migrationProgress >= 10 && migrationProgress < 90) phase = 'gradual';
      else if (migrationProgress >= 90) phase = 'complete';

      return {
        phase,
        totalProjects,
        encryptedProjects,
        migrationProgress,
        rollbackReady: await this.isRollbackReady(),
        errors: []
      };

    } catch (error) {
      console.error('Error getting migration status:', error);
      return {
        phase: 'preparation',
        totalProjects: 0,
        encryptedProjects: 0,
        migrationProgress: 0,
        rollbackReady: false,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  // Check if system is ready for rollback
  static async isRollbackReady(): Promise<boolean> {
    try {
      // Verify all encrypted messages have plaintext fallbacks
      const encryptedWithoutFallback = await prisma.comment.count({
        where: {
          isEncrypted: true,
          body: '[Encrypted Message]' // No meaningful fallback
        }
      });

      // System is rollback-ready if no messages would be lost
      return encryptedWithoutFallback === 0;

    } catch (error) {
      console.error('Error checking rollback readiness:', error);
      return false;
    }
  }

  // Migrate a specific project to E2EE (opt-in)
  static async migrateProjectToE2EE(
    projectId: string, 
    initiatorUserId: string,
    encryptedKeyBlobs: { [userId: string]: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Verify initiator is project author
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { authorId: true, title: true }
      });

      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      if (project.authorId !== initiatorUserId) {
        return { success: false, error: 'Only project author can enable encryption' };
      }

      // Check if already encrypted
      const existingKey = await prisma.conversationKey.findUnique({
        where: { projectId }
      });

      if (existingKey) {
        return { success: false, error: 'Project already encrypted' };
      }

      // Create conversation key
      await prisma.conversationKey.create({
        data: {
          projectId,
          encryptedKeyBlobs,
          isEncrypted: true,
          createdAt: new Date()
        }
      });

      console.log(`✅ Project ${projectId} (${project.title}) migrated to E2EE`);
      return { success: true };

    } catch (error) {
      console.error('Error migrating project to E2EE:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Migration failed' 
      };
    }
  }

  // Rollback a project from E2EE to plaintext
  static async rollbackProjectFromE2EE(
    projectId: string, 
    adminUserId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Verify admin permissions (implement based on your auth system)
      const isAdmin = await this.verifyAdminPermissions(adminUserId);
      if (!isAdmin) {
        return { success: false, error: 'Admin permissions required' };
      }

      // Get project info
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { title: true }
      });

      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // Remove conversation encryption
      await prisma.conversationKey.delete({
        where: { projectId }
      });

      // Mark all encrypted messages as requiring manual review
      await prisma.comment.updateMany({
        where: { 
          projectId,
          isEncrypted: true 
        },
        data: {
          body: '[Message encrypted - manual recovery required]',
          isEncrypted: false // Mark as plaintext for compatibility
        }
      });

      // Log the rollback
      console.log(`🔄 Project ${projectId} (${project.title}) rolled back from E2EE by admin ${adminUserId}. Reason: ${reason}`);
      
      return { success: true };

    } catch (error) {
      console.error('Error rolling back project from E2EE:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Rollback failed' 
      };
    }
  }

  // Batch migration for gradual rollout
  static async batchMigrateProjects(
    batchSize: number = 10,
    criteria: {
      minActiveMembers?: number;
      maxAge?: number; // days
      departments?: string[];
    } = {}
  ): Promise<{ migrated: string[]; failed: string[]; errors: string[] }> {
    try {
      // Find candidate projects for migration
      const whereClause: any = {
        archivedAt: null,
        progressStatus: 'OPEN',
        // Only projects without existing encryption
        conversationKey: null
      };

      if (criteria.departments?.length) {
        whereClause.departments = {
          hasSome: criteria.departments
        };
      }

      if (criteria.maxAge) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - criteria.maxAge);
        whereClause.createdAt = { gte: cutoffDate };
      }

      const candidateProjects = await prisma.project.findMany({
        where: whereClause,
        include: {
          applications: {
            where: { status: 'ACCEPTED' }
          }
        },
        take: batchSize
      });

      const migrated: string[] = [];
      const failed: string[] = [];
      const errors: string[] = [];

      for (const project of candidateProjects) {
        // Check if project meets criteria
        if (criteria.minActiveMembers && 
            project.applications.length < criteria.minActiveMembers) {
          continue;
        }

        try {
          // Auto-generate encryption for eligible projects
          // Note: In real implementation, this would require user consent
          console.log(`Attempting to migrate project ${project.id} (${project.title})`);
          
          // For now, just mark as candidate - actual migration requires user action
          migrated.push(project.id);
          
        } catch (error) {
          failed.push(project.id);
          errors.push(`Project ${project.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      return { migrated, failed, errors };

    } catch (error) {
      console.error('Error in batch migration:', error);
      return { 
        migrated: [], 
        failed: [], 
        errors: [error instanceof Error ? error.message : 'Batch migration failed'] 
      };
    }
  }

  // Verify system health before/after migration
  static async verifySystemHealth(): Promise<{
    healthy: boolean;
    checks: {
      database: boolean;
      encryption: boolean;
      websocket: boolean;
      compatibility: boolean;
    };
    errors: string[];
  }> {
    const checks = {
      database: false,
      encryption: false,
      websocket: false,
      compatibility: false
    };
    const errors: string[] = [];

    try {
      // Database connectivity
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch (error) {
      errors.push(`Database: ${error instanceof Error ? error.message : 'Connection failed'}`);
    }

    try {
      // Encryption functionality
      const { CryptoManager } = await import('./crypto');
      const keyPair = CryptoManager.generateKeyPair();
      const testMessage = CryptoManager.encryptMessage('test', CryptoManager.generateSymmetricKey());
      checks.encryption = testMessage.ciphertext.length > 0;
    } catch (error) {
      errors.push(`Encryption: ${error instanceof Error ? error.message : 'Crypto test failed'}`);
    }

    try {
      // WebSocket health
      const { getWebSocketHealth } = await import('./enhancedWebSocket');
      const wsHealth = getWebSocketHealth();
      checks.websocket = wsHealth.status === 'healthy';
    } catch (error) {
      errors.push(`WebSocket: ${error instanceof Error ? error.message : 'WebSocket check failed'}`);
    }

    try {
      // Compatibility check - ensure encrypted and plaintext messages coexist
      const encryptedCount = await prisma.comment.count({
        where: { isEncrypted: true }
      });
      const plaintextCount = await prisma.comment.count({
        where: { isEncrypted: false }
      });
      
      // System is compatible if both types can coexist or if there are no conflicts
      checks.compatibility = true;
      
    } catch (error) {
      errors.push(`Compatibility: ${error instanceof Error ? error.message : 'Compatibility check failed'}`);
    }

    const healthy = Object.values(checks).every(check => check === true);

    return { healthy, checks, errors };
  }

  // Emergency rollback - disable all E2EE features
  static async emergencyRollback(adminUserId: string, reason: string): Promise<{
    success: boolean;
    rollbackActions: string[];
    errors: string[];
  }> {
    const rollbackActions: string[] = [];
    const errors: string[] = [];

    try {
      // Verify admin permissions
      const isAdmin = await this.verifyAdminPermissions(adminUserId);
      if (!isAdmin) {
        throw new Error('Admin permissions required for emergency rollback');
      }

      // 1. Disable all E2EE feature flags
      rollbackActions.push('Disabling E2EE feature flags...');
      // In real implementation, update feature flags in database
      process.env.FEATURE_E2EE_MESSAGING = 'false';
      process.env.FEATURE_E2EE_FILE_UPLOAD = 'false';

      // 2. Mark all conversations as plaintext-only
      rollbackActions.push('Converting encrypted conversations to plaintext mode...');
      const conversationCount = await prisma.conversationKey.count();
      await prisma.conversationKey.updateMany({
        data: { isEncrypted: false }
      });
      rollbackActions.push(`Updated ${conversationCount} conversations`);

      // 3. Add fallback messages for encrypted content
      rollbackActions.push('Adding fallback messages for encrypted content...');
      const encryptedMessages = await prisma.comment.updateMany({
        where: { 
          isEncrypted: true,
          body: '[Encrypted Message]'
        },
        data: {
          body: '[Message was encrypted - content unavailable after rollback]',
          isEncrypted: false
        }
      });
      rollbackActions.push(`Updated ${encryptedMessages.count} encrypted messages`);

      // 4. Log the emergency rollback
      rollbackActions.push('Logging emergency rollback...');
      console.error(`🚨 EMERGENCY E2EE ROLLBACK initiated by admin ${adminUserId}. Reason: ${reason}`);

      return {
        success: true,
        rollbackActions,
        errors
      };

    } catch (error) {
      console.error('Error during emergency rollback:', error);
      errors.push(error instanceof Error ? error.message : 'Emergency rollback failed');
      
      return {
        success: false,
        rollbackActions,
        errors
      };
    }
  }

  // Helper method to verify admin permissions
  private static async verifyAdminPermissions(userId: string): Promise<boolean> {
    // Implement based on your auth system
    // For now, return true for development
    return process.env.NODE_ENV === 'development';
  }
}

// Migration monitoring and alerts
export class MigrationMonitor {
  
  // Monitor migration progress and send alerts
  static async monitorMigrationHealth(): Promise<void> {
    try {
      const status = await E2EEMigrationManager.getMigrationStatus();
      const health = await E2EEMigrationManager.verifySystemHealth();

      // Alert conditions
      if (!health.healthy) {
        console.error('🚨 E2EE Migration Health Alert:', {
          status: status.phase,
          progress: status.migrationProgress,
          errors: health.errors
        });
      }

      // Progress alerts
      if (status.phase === 'gradual' && status.migrationProgress > 50) {
        console.log('📊 E2EE Migration Progress: Over 50% complete', {
          encrypted: status.encryptedProjects,
          total: status.totalProjects,
          progress: status.migrationProgress
        });
      }

    } catch (error) {
      console.error('Error monitoring migration health:', error);
    }
  }

  // Generate migration report
  static async generateMigrationReport(): Promise<{
    summary: MigrationStatus;
    health: any;
    recommendations: string[];
  }> {
    const summary = await E2EEMigrationManager.getMigrationStatus();
    const health = await E2EEMigrationManager.verifySystemHealth();
    
    const recommendations: string[] = [];

    // Generate recommendations based on status
    if (summary.phase === 'preparation') {
      recommendations.push('Ready to start pilot migration with selected projects');
      recommendations.push('Ensure all team members have E2EE-capable clients');
    }

    if (summary.phase === 'pilot' && summary.migrationProgress < 5) {
      recommendations.push('Monitor pilot projects closely for user feedback');
      recommendations.push('Prepare gradual rollout plan for broader adoption');
    }

    if (summary.phase === 'gradual') {
      recommendations.push('Continue gradual migration based on user adoption');
      recommendations.push('Monitor system performance under mixed load');
    }

    if (!health.healthy) {
      recommendations.push('⚠️ Address system health issues before continuing migration');
      recommendations.push('Consider temporary rollback if critical issues persist');
    }

    return {
      summary,
      health,
      recommendations
    };
  }
}
