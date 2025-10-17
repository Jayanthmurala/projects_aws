import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminProjectService } from '../services/AdminProjectService';
import { AdminApplicationService } from '../services/AdminApplicationService';
import { AuditLogger } from '../utils/auditLogger';
import { prisma } from '../../db';
import { getCache } from '../../utils/cache';
import { 
  ProjectFilters, 
  PaginationParams, 
  ProjectModerationRequest,
  ProjectUpdateRequest,
  BulkProjectOperation,
  ApplicationStatusUpdate,
  BulkApplicationOperation,
  AdminResponse 
} from '../types/adminTypes';

const cache = getCache();

export class HeadAdminController {
  /**
   * Get HEAD_ADMIN dashboard data
   */
  static async getDashboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;

      // Optimize dashboard queries with single aggregation query
      const collegeId = adminAuth.scope.collegeId;
      const whereClause = collegeId ? { collegeId } : {};

      const [dashboardStats, recentProjects] = await Promise.all([
        // Single aggregation query for all statistics
        prisma.$queryRaw`
          SELECT 
            COUNT(CASE WHEN p.moderation_status = 'PENDING_APPROVAL' THEN 1 END)::int as pending_projects,
            COUNT(CASE WHEN p.moderation_status = 'APPROVED' THEN 1 END)::int as approved_projects,
            COUNT(CASE WHEN p.moderation_status = 'REJECTED' THEN 1 END)::int as rejected_projects,
            COUNT(CASE WHEN p.progress_status = 'OPEN' THEN 1 END)::int as open_projects,
            COUNT(CASE WHEN p.progress_status = 'IN_PROGRESS' THEN 1 END)::int as in_progress_projects,
            COUNT(CASE WHEN p.progress_status = 'COMPLETED' THEN 1 END)::int as completed_projects,
            COUNT(CASE WHEN a.status = 'PENDING' THEN 1 END)::int as pending_applications,
            COUNT(CASE WHEN a.status = 'ACCEPTED' THEN 1 END)::int as accepted_applications,
            COUNT(CASE WHEN a.status = 'REJECTED' THEN 1 END)::int as rejected_applications,
            COUNT(DISTINCT p.id)::int as total_projects,
            COUNT(DISTINCT a.id)::int as total_applications
          FROM "Project" p
          LEFT JOIN "AppliedProject" a ON p.id = a.project_id
          WHERE p.archived_at IS NULL
            ${collegeId ? `AND p.college_id = '${collegeId}'` : ''}
        `,
        // Recent projects query
        prisma.project.findMany({
          where: {
            ...whereClause,
            moderationStatus: 'PENDING_APPROVAL',
            archivedAt: null
          },
          select: {
            id: true,
            title: true,
            authorName: true,
            projectType: true,
            createdAt: true,
            _count: {
              select: {
                applications: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 5
        })
      ]);

      // Transform the raw query result into the expected format
      const stats = (dashboardStats as any[])[0];
      const projectAnalytics = {
        totalProjects: stats.total_projects,
        projectsByStatus: {
          pending: stats.pending_projects,
          approved: stats.approved_projects,
          rejected: stats.rejected_projects
        },
        projectsByProgress: {
          open: stats.open_projects,
          inProgress: stats.in_progress_projects,
          completed: stats.completed_projects
        }
      };

      const applicationAnalytics = {
        totalApplications: stats.total_applications,
        applicationsByStatus: {
          pending: stats.pending_applications,
          accepted: stats.accepted_applications,
          rejected: stats.rejected_applications
        }
      };

      await AuditLogger.logLogin(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: {
          projectAnalytics,
          applicationAnalytics,
          recentProjects: recentProjects,
          summary: {
            totalProjects: projectAnalytics.totalProjects,
            pendingApproval: projectAnalytics.projectsByStatus.pending,
            totalApplications: applicationAnalytics.totalApplications,
            pendingApplications: applicationAnalytics.applicationsByStatus.pending
          }
        }
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load dashboard'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get projects with filtering
   */
  static async getProjects(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const query = request.query as any;

      const filters: ProjectFilters = {
        search: query.search,
        moderationStatus: query.moderationStatus ? query.moderationStatus.split(',') : undefined,
        progressStatus: query.progressStatus ? query.progressStatus.split(',') : undefined,
        projectType: query.projectType ? query.projectType.split(',') : undefined,
        department: query.department,
        authorId: query.authorId,
        tags: query.tags ? query.tags.split(',') : undefined,
        skills: query.skills ? query.skills.split(',') : undefined,
        isOverdue: query.isOverdue === 'true',
        createdAfter: query.createdAfter ? new Date(query.createdAfter) : undefined,
        createdBefore: query.createdBefore ? new Date(query.createdBefore) : undefined,
        deadlineAfter: query.deadlineAfter ? new Date(query.deadlineAfter) : undefined,
        deadlineBefore: query.deadlineBefore ? new Date(query.deadlineBefore) : undefined
      };

      const pagination: PaginationParams = {
        page: parseInt(query.page) || 1,
        limit: parseInt(query.limit) || 20,
        sortBy: query.sortBy || 'createdAt',
        sortOrder: query.sortOrder || 'desc'
      };

      const result = await AdminProjectService.getProjects(filters, pagination, adminAuth);

      const response: AdminResponse = {
        success: true,
        data: result.projects,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch projects'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get single project details
   */
  static async getProject(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { projectId } = request.params as { projectId: string };

      const project = await AdminProjectService.getProjectById(projectId, adminAuth);

      const response: AdminResponse = {
        success: true,
        data: project
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Project not found'
      };
      return reply.status(404).send(response);
    }
  }

  /**
   * Update project - HEAD_ADMIN can edit any project in their college
   */
  static async updateProject(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { projectId } = request.params as { projectId: string };
      const updateData = request.body as ProjectUpdateRequest;

      // Check if project exists and admin has access
      const existingProject = await prisma.project.findUnique({
        where: { id: projectId }
      });

      if (!existingProject) {
        const response: AdminResponse = {
          success: false,
          message: 'Project not found'
        };
        return reply.status(404).send(response);
      }

      // HEAD_ADMIN can only edit projects in their college (unless SUPER_ADMIN)
      if (adminAuth.scope.collegeId && 
          existingProject.collegeId !== adminAuth.scope.collegeId && 
          !adminAuth.roles.includes("SUPER_ADMIN")) {
        const response: AdminResponse = {
          success: false,
          message: 'Access denied. You can only edit projects in your college.'
        };
        return reply.status(403).send(response);
      }

      // Prepare update data with validation
      const updateFields: any = {};
      if (updateData.title) updateFields.title = updateData.title;
      if (updateData.description) updateFields.description = updateData.description;
      if (updateData.projectDuration) updateFields.projectDuration = updateData.projectDuration;
      if (updateData.skills) updateFields.skills = updateData.skills;
      if (updateData.departments) updateFields.departments = updateData.departments;
      if (updateData.visibleToAllDepts !== undefined) updateFields.visibleToAllDepts = updateData.visibleToAllDepts;
      if (updateData.projectType) updateFields.projectType = updateData.projectType;
      if (updateData.maxStudents) updateFields.maxStudents = updateData.maxStudents;
      if (updateData.deadline) updateFields.deadline = new Date(updateData.deadline);
      if (updateData.tags) updateFields.tags = updateData.tags;
      if (updateData.requirements) updateFields.requirements = updateData.requirements;
      if (updateData.outcomes) updateFields.outcomes = updateData.outcomes;
      if (updateData.progressStatus) updateFields.progressStatus = updateData.progressStatus;

      updateFields.updatedAt = new Date();

      const updatedProject = await prisma.project.update({
        where: { id: projectId },
        data: updateFields,
        include: {
          applications: true,
          _count: { select: { applications: true } }
        }
      });

      // Log the update action
      await AuditLogger.log({
        adminId: adminAuth.userId,
        adminName: adminAuth.name || adminAuth.email || 'Unknown Admin',
        action: 'PROJECT_UPDATE',
        entityType: 'PROJECT',
        entityId: projectId,
        oldValues: existingProject,
        newValues: updatedProject,
        reason: 'Project updated by HEAD_ADMIN',
        collegeId: adminAuth.scope.collegeId
      }, request);

      const response: AdminResponse = {
        success: true,
        data: updatedProject,
        message: 'Project updated successfully'
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update project'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Delete project - HEAD_ADMIN can delete any project in their college
   */
  static async deleteProject(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { projectId } = request.params as { projectId: string };

      // Check if project exists and admin has access
      const existingProject = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          applications: true,
          tasks: true,
          attachments: true,
          comments: true
        }
      });

      if (!existingProject) {
        const response: AdminResponse = {
          success: false,
          message: 'Project not found'
        };
        return reply.status(404).send(response);
      }

      // HEAD_ADMIN can only delete projects in their college (unless SUPER_ADMIN)
      if (adminAuth.scope.collegeId && 
          existingProject.collegeId !== adminAuth.scope.collegeId && 
          !adminAuth.roles.includes("SUPER_ADMIN")) {
        const response: AdminResponse = {
          success: false,
          message: 'Access denied. You can only delete projects in your college.'
        };
        return reply.status(403).send(response);
      }

      // Check if project has active applications
      const activeApplications = existingProject.applications.filter(app => 
        app.status === 'PENDING' || app.status === 'ACCEPTED'
      );

      if (activeApplications.length > 0) {
        const response: AdminResponse = {
          success: false,
          message: `Cannot delete project with ${activeApplications.length} active applications. Please reject or process them first.`
        };
        return reply.status(400).send(response);
      }

      // Soft delete by setting archivedAt (preserves data for audit)
      const deletedProject = await prisma.project.update({
        where: { id: projectId },
        data: {
          archivedAt: new Date(),
          moderationStatus: 'REJECTED' // Mark as rejected when deleted
        }
      });

      // Log the deletion action
      await AuditLogger.log({
        adminId: adminAuth.userId,
        adminName: adminAuth.name || adminAuth.email || 'Unknown Admin',
        action: 'PROJECT_DELETE',
        entityType: 'PROJECT',
        entityId: projectId,
        oldValues: existingProject,
        newValues: { archivedAt: deletedProject.archivedAt, moderationStatus: 'REJECTED' },
        reason: 'Project deleted by HEAD_ADMIN',
        collegeId: adminAuth.scope.collegeId
      }, request);

      const response: AdminResponse = {
        success: true,
        data: { projectId, deletedAt: deletedProject.archivedAt },
        message: 'Project deleted successfully'
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to delete project'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Moderate project
   */
  static async moderateProject(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { projectId } = request.params as { projectId: string };
      const moderation = request.body as ProjectModerationRequest;

      const result = await AdminProjectService.moderateProject(projectId, moderation, adminAuth);

      await AuditLogger.logProjectModeration(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        projectId,
        result.oldProject,
        result.newProject,
        result.action,
        result.reason,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: result.newProject,
        message: `Project ${result.action.toLowerCase()}d successfully`
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to moderate project'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Bulk project operations
   */
  static async bulkProjectOperation(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const operation = request.body as BulkProjectOperation;

      const result = await AdminProjectService.bulkProjectOperation(operation, adminAuth);

      await AuditLogger.logBulkOperation(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        `PROJECT_${operation.action}`,
        'PROJECT',
        operation.projectIds,
        { action: operation.action, reason: operation.reason },
        operation.reason,
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: result,
        message: `Bulk operation completed: ${result.successful} successful, ${result.failed} failed`
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Bulk operation failed'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Get applications
   */
  static async getApplications(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const query = request.query as any;

      const filters = {
        search: query.search,
        status: query.status ? query.status.split(',') : undefined,
        studentDepartment: query.studentDepartment,
        projectId: query.projectId,
        studentId: query.studentId,
        appliedAfter: query.appliedAfter ? new Date(query.appliedAfter) : undefined,
        appliedBefore: query.appliedBefore ? new Date(query.appliedBefore) : undefined
      };

      const pagination = {
        page: parseInt(query.page) || 1,
        limit: parseInt(query.limit) || 20,
        sortBy: query.sortBy || 'appliedAt',
        sortOrder: query.sortOrder || 'desc'
      };

      const result = await AdminApplicationService.getApplications(filters, pagination, adminAuth);

      const response: AdminResponse = {
        success: true,
        data: result.applications,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch applications'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Update application status
   */
  static async updateApplicationStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { applicationId } = request.params as { applicationId: string };
      const statusUpdate = request.body as ApplicationStatusUpdate;

      const result = await AdminApplicationService.updateApplicationStatus(
        applicationId, 
        statusUpdate, 
        adminAuth
      );

      await AuditLogger.logApplicationStatusChange(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        applicationId,
        result.oldStatus,
        result.newStatus,
        result.reason,
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: result.application,
        message: `Application status updated to ${result.newStatus}`
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update application status'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Bulk application operations
   */
  static async bulkApplicationUpdate(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const operation = request.body as BulkApplicationOperation;

      // TODO: Implement bulkApplicationUpdate in AdminApplicationService
      const result = { successful: 0, failed: 0, message: 'Bulk application update not yet implemented' };

      await AuditLogger.logBulkOperation(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        `APPLICATION_${operation.status}`,
        'APPLICATION',
        operation.applicationIds,
        { status: operation.status, reason: operation.reason },
        operation.reason,
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: result,
        message: `Bulk application update completed: ${result.successful} successful, ${result.failed} failed`
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Bulk application update failed'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Get analytics
   */
  static async getAnalytics(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { type, timeRange } = request.query as { type?: string; timeRange?: string };

      let analyticsData;

      switch (type) {
        case 'projects':
          analyticsData = await AdminProjectService.getProjectAnalytics(adminAuth, timeRange);
          break;
        case 'applications':
          analyticsData = await AdminApplicationService.getApplicationAnalytics(adminAuth, timeRange);
          break;
        default:
          // Combined analytics
          const [projectAnalytics, applicationAnalytics] = await Promise.all([
            AdminProjectService.getProjectAnalytics(adminAuth, timeRange),
            AdminApplicationService.getApplicationAnalytics(adminAuth, timeRange)
          ]);
          analyticsData = { projects: projectAnalytics, applications: applicationAnalytics };
      }

      await AuditLogger.logAnalyticsView(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        type || 'combined',
        { timeRange },
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: analyticsData
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch analytics'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get project applications
   */
  static async getProjectApplications(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { projectId } = request.params as { projectId: string };
      const authHeader = request.headers.authorization || '';

      // Use existing getApplications method with projectId filter
      const result = await AdminApplicationService.getApplications(
        { projectId },
        { page: 1, limit: 1000, sortBy: 'appliedAt', sortOrder: 'desc' },
        adminAuth
      );

      const response: AdminResponse = {
        success: true,
        data: result
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch project applications'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Export data
   */
  static async exportData(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      
      // Rate limiting check
      const rateLimitKey = `admin_export:${adminAuth.userId}`;
      const currentCount = await cache.get(rateLimitKey);
      const count = currentCount ? parseInt(currentCount) : 0;
      
      if (count >= 3) {
        return reply.status(429).send({
          success: false,
          error: 'Export rate limit exceeded',
          message: 'You can export data 3 times per hour. Please try again later.'
        });
      }
      
      // Increment counter
      await cache.set(rateLimitKey, (count + 1).toString(), 3600); // 1 hour TTL
      
      const { type, format } = request.query as { type: string; format?: string };

      // Limit export size for performance and security
      const MAX_EXPORT_RECORDS = 1000;
      let csvContent: string;
      let filename: string;

      switch (type) {
        case 'projects':
          const projects = await AdminProjectService.getProjects(
            {},
            { page: 1, limit: MAX_EXPORT_RECORDS, sortBy: 'createdAt', sortOrder: 'desc' },
            adminAuth
          );

          const projectHeaders = ['Title', 'Author', 'Department', 'Type', 'Status', 'Progress', 'Applications', 'Created'];
          const projectRows = projects.projects.map(project => [
            project.title,
            project.authorName,
            project.authorDepartment || '',
            project.projectType,
            project.moderationStatus,
            project.progressStatus,
            project.applicationCount || 0,
            project.createdAt.toISOString().split('T')[0]
          ]);

          csvContent = [
            projectHeaders.join(','),
            ...projectRows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
          ].join('\n');

          filename = `projects-export-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        case 'applications':
          // Limit export size for performance and security
          const applications = await AdminApplicationService.getApplications(
            {},
            { page: 1, limit: MAX_EXPORT_RECORDS, sortBy: 'appliedAt', sortOrder: 'desc' },
            adminAuth
          );

          const appHeaders = ['Student Name', 'Department', 'Project Title', 'Status', 'Applied Date'];
          const appRows = applications.applications.map((app: any) => [
            app.studentName,
            app.studentDepartment,
            app.project.title,
            app.status,
            app.appliedAt.toISOString().split('T')[0]
          ]);

          csvContent = [
            appHeaders.join(','),
            ...appRows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
          ].join('\n');

          filename = `applications-export-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        default:
          throw new Error('Invalid export type');
      }

      await AuditLogger.logDataExport(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        type,
        csvContent.split('\n').length - 1, // Row count
        { format: format || 'csv' },
        adminAuth.scope.collegeId,
        request
      );

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(csvContent);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to export data'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Export applications with detailed student data
   */
  static async exportApplications(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const query = request.query as any;

      // Build filters from query parameters
      const filters: any = {};
      if (query.status) {
        filters.status = query.status.split(',');
      }
      if (query.studentDepartment) {
        filters.studentDepartment = query.studentDepartment;
      }
      if (query.projectId) {
        filters.projectId = query.projectId;
      }

      const authHeader = request.headers.authorization || '';
      const applications = await AdminApplicationService.getApplicationsForExport(filters, adminAuth, authHeader);

      // Generate CSV content
      const csvHeaders = [
        'Student Name',
        'Student Email', 
        'Department',
        'Registration Number',
        'Year',
        'Project Title',
        'Project Author',
        'Application Status',
        'Applied Date',
        'Cover Letter'
      ];

      const csvRows = applications.map((app: any) => [
        app.studentName,
        app.studentEmail || 'N/A',
        app.studentDepartment,
        app.studentRegistrationNumber || 'N/A',
        app.studentYear || 'N/A',
        app.project?.title || 'N/A',
        app.project?.authorName || 'N/A',
        app.status,
        new Date(app.appliedAt).toLocaleDateString(),
        (app.message || '').replace(/"/g, '""') // Escape quotes for CSV
      ]);

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n');

      // TODO: Implement audit logging
      // await AuditLogger.logAction(
      //   adminAuth.userId,
      //   adminAuth.name || adminAuth.email || 'Unknown Admin',
      //   'EXPORT_APPLICATIONS',
      //   'APPLICATION',
      //   'bulk',
      //   null,
      //   { filters, count: applications.length },
      //   'Exported applications data',
      //   adminAuth.scope.collegeId,
      //   request
      // );

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="applications-export-${new Date().toISOString().split('T')[0]}.csv"`);
      return reply.send(csvContent);

    } catch (error) {
      console.error('Export applications error:', error);
      const response: AdminResponse = {
        success: false,
        message: 'Failed to export applications data'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get audit logs
   */
  static async getAuditLogs(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const query = request.query as any;

      // Parse pagination
      const page = parseInt(query.page) || 1;
      const limit = Math.min(parseInt(query.limit) || 50, 100);
      const skip = (page - 1) * limit;

      // Build filters
      const where: any = {};
      
      // Scope to college
      if (adminAuth.scope.collegeId && !adminAuth.roles.includes("SUPER_ADMIN")) {
        where.collegeId = adminAuth.scope.collegeId;
      }

      if (query.entityType) where.entityType = query.entityType;
      if (query.entityId) where.entityId = query.entityId;
      if (query.action) where.action = query.action;
      if (query.adminId) where.adminId = query.adminId;
      if (query.startDate) {
        where.createdAt = { gte: new Date(query.startDate) };
      }
      if (query.endDate) {
        where.createdAt = { 
          ...where.createdAt,
          lte: new Date(query.endDate) 
        };
      }

      const [logs, total] = await Promise.all([
        prisma.adminAuditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.adminAuditLog.count({ where })
      ]);

      const response: AdminResponse = {
        success: true,
        data: {
          logs,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        }
      };

      return reply.send(response);

    } catch (error) {
      console.error('Get audit logs error:', error);
      const response: AdminResponse = {
        success: false,
        message: 'Failed to fetch audit logs'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get project activity logs
   */
  static async getProjectActivity(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { projectId } = request.params as { projectId: string };

      // First verify access to the project
      const project = await prisma.project.findUnique({
        where: { id: projectId }
      });

      if (!project) {
        const response: AdminResponse = {
          success: false,
          message: 'Project not found'
        };
        return reply.status(404).send(response);
      }

      // Check access permissions
      if (adminAuth.scope.collegeId && project.collegeId !== adminAuth.scope.collegeId) {
        const response: AdminResponse = {
          success: false,
          message: 'Access denied'
        };
        return reply.status(403).send(response);
      }

      if (adminAuth.roles.includes("DEPT_ADMIN") && 
          project.authorDepartment !== adminAuth.scope.department) {
        const response: AdminResponse = {
          success: false,
          message: 'Access denied'
        };
        return reply.status(403).send(response);
      }

      // Get activity logs for this project
      const logs = await prisma.adminAuditLog.findMany({
        where: {
          entityType: 'PROJECT',
          entityId: projectId,
          collegeId: adminAuth.scope.collegeId
        },
        orderBy: { createdAt: 'desc' },
        take: 100 // Limit to recent 100 activities
      });

      const response: AdminResponse = {
        success: true,
        data: logs
      };

      return reply.send(response);

    } catch (error) {
      console.error('Get project activity error:', error);
      const response: AdminResponse = {
        success: false,
        message: 'Failed to fetch project activity'
      };
      return reply.status(500).send(response);
    }
  }
}
