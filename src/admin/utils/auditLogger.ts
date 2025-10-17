import { prisma } from "../../db";
import type { FastifyRequest } from "fastify";
import { AuditLogData } from "../types/adminTypes";

export class AuditLogger {
  static async log(data: AuditLogData, req?: FastifyRequest) {
    try {
      const ipAddress = req?.ip || req?.headers['x-forwarded-for'] as string || req?.socket?.remoteAddress;
      const userAgent = req?.headers['user-agent'] as string;

      // Use type assertion for now until Prisma client is regenerated
      await (prisma as any).adminAuditLog.create({
        data: {
          adminId: data.adminId,
          adminName: data.adminName,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          oldValues: data.oldValues ? JSON.parse(JSON.stringify(data.oldValues)) : null,
          newValues: data.newValues ? JSON.parse(JSON.stringify(data.newValues)) : null,
          reason: data.reason,
          collegeId: data.collegeId,
          ipAddress,
          userAgent,
        },
      });

      console.log(`[AUDIT] ${data.action} on ${data.entityType}:${data.entityId} by ${data.adminName} (${data.adminId})`);
    } catch (error: any) {
      console.error('[AUDIT ERROR] Failed to log admin action:', error);
      // Don't throw error to avoid breaking the main operation
    }
  }

  static async logProjectUpdate(
    adminId: string,
    adminName: string,
    projectId: string,
    oldProject: any,
    newProject: any,
    updateData: any,
    collegeId?: string,
    req?: FastifyRequest
  ) {
    await this.log({
      adminId,
      adminName,
      action: 'UPDATE_PROJECT',
      entityType: 'PROJECT',
      entityId: projectId,
      oldValues: {
        title: oldProject.title,
        description: oldProject.description,
        projectType: oldProject.projectType,
        skills: oldProject.skills,
        maxStudents: oldProject.maxStudents,
        deadline: oldProject.deadline,
        tags: oldProject.tags,
        requirements: oldProject.requirements,
        outcomes: oldProject.outcomes,
      },
      newValues: {
        title: newProject.title,
        description: newProject.description,
        projectType: newProject.projectType,
        skills: newProject.skills,
        maxStudents: newProject.maxStudents,
        deadline: newProject.deadline,
        tags: newProject.tags,
        requirements: newProject.requirements,
        outcomes: newProject.outcomes,
        updatedFields: Object.keys(updateData),
      },
      collegeId: collegeId || oldProject.collegeId,
    }, req);
  }

  static async logProjectModeration(
    adminId: string,
    adminName: string,
    projectId: string,
    oldProject: any,
    newProject: any,
    action: string,
    reason?: string,
    req?: FastifyRequest
  ) {
    await this.log({
      adminId,
      adminName,
      action: `MODERATE_PROJECT_${action}`,
      entityType: 'PROJECT',
      entityId: projectId,
      oldValues: {
        moderationStatus: oldProject.moderationStatus,
        progressStatus: oldProject.progressStatus,
        archivedAt: oldProject.archivedAt,
      },
      newValues: {
        moderationStatus: newProject.moderationStatus,
        progressStatus: newProject.progressStatus,
        archivedAt: newProject.archivedAt,
      },
      reason,
      collegeId: oldProject.collegeId,
    }, req);
  }

  static async logBulkOperation(
    adminId: string,
    adminName: string,
    action: string,
    entityType: string,
    entityIds: string[],
    changes: any,
    reason?: string,
    collegeId?: string,
    req?: FastifyRequest
  ) {
    await this.log({
      adminId,
      adminName,
      action: `BULK_${action}`,
      entityType,
      entityId: entityIds.join(','),
      newValues: {
        affectedCount: entityIds.length,
        changes,
      },
      reason,
      collegeId,
    }, req);
  }

  static async logApplicationStatusChange(
    adminId: string,
    adminName: string,
    applicationId: string,
    oldStatus: string,
    newStatus: string,
    reason?: string,
    collegeId?: string,
    req?: FastifyRequest
  ) {
    await this.log({
      adminId,
      adminName,
      action: 'UPDATE_APPLICATION_STATUS',
      entityType: 'APPLICATION',
      entityId: applicationId,
      oldValues: { status: oldStatus },
      newValues: { status: newStatus },
      reason,
      collegeId,
    }, req);
  }

  static async logLogin(
    adminId: string,
    adminName: string,
    collegeId?: string,
    req?: FastifyRequest
  ) {
    await this.log({
      adminId,
      adminName,
      action: 'LOGIN',
      entityType: 'DASHBOARD',
      entityId: 'admin_dashboard',
      collegeId,
    }, req);
  }

  static async logDataExport(
    adminId: string,
    adminName: string,
    exportType: string,
    recordCount: number,
    filters: any,
    collegeId?: string,
    req?: FastifyRequest
  ) {
    await this.log({
      adminId,
      adminName,
      action: 'EXPORT_DATA',
      entityType: 'DATA_EXPORT',
      entityId: exportType,
      newValues: {
        recordCount,
        filters,
        timestamp: new Date().toISOString()
      },
      collegeId,
    }, req);
  }

  static async logAnalyticsView(
    adminId: string,
    adminName: string,
    analyticsType: string,
    filters: any,
    collegeId?: string,
    req?: FastifyRequest
  ) {
    await this.log({
      adminId,
      adminName,
      action: 'VIEW_ANALYTICS',
      entityType: 'ANALYTICS',
      entityId: analyticsType,
      newValues: {
        filters,
        timestamp: new Date().toISOString()
      },
      collegeId,
    }, req);
  }

  static async logBulkApplicationUpdate(
    adminId: string,
    adminName: string,
    bulkOperation: any,
    result: any,
    collegeId?: string,
    req?: FastifyRequest
  ) {
    await this.log({
      adminId,
      adminName,
      action: 'BULK_UPDATE_APPLICATIONS',
      entityType: 'APPLICATION',
      entityId: `bulk_${bulkOperation.applicationIds.length}_applications`,
      oldValues: {
        applicationIds: bulkOperation.applicationIds,
        targetStatus: bulkOperation.status
      },
      newValues: {
        totalProcessed: result.totalProcessed,
        successful: result.successful,
        failed: result.failed,
        errors: result.errors,
        reason: bulkOperation.reason,
        feedback: bulkOperation.feedback
      },
      reason: bulkOperation.reason,
      collegeId,
    }, req);
  }
}
