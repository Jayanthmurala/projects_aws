import { prisma } from '../../db';
import { ApplicationStatus } from '@prisma/client';
import { getUserIdentity } from '../../clients/auth';
import { 
  BulkApplicationOperation,
  BulkOperationResult,
  ApplicationStatusUpdate,
  ADMIN_LIMITS
} from '../types/adminTypes';
import { canManageApplication } from '../middleware/adminAuth';

export class AdminApplicationService {
  /**
   * Get applications with admin scope and filtering
   */
  static async getApplications(
    filters: any,
    pagination: any,
    adminAuth: any
  ) {
    const { page, limit, sortBy = 'appliedAt', sortOrder = 'desc' } = pagination;
    const skip = (page - 1) * limit;
    const take = Math.min(limit, 100);

    // Build where clause
    const where: any = {};

    // Apply admin scope through project relationship
    const projectWhere: any = {};
    if (adminAuth.scope.collegeId && !adminAuth.roles.includes("SUPER_ADMIN")) {
      projectWhere.collegeId = adminAuth.scope.collegeId;
    }

    // DEPT_ADMIN can only see applications for projects in their department
    if (adminAuth.roles.includes("DEPT_ADMIN") && adminAuth.scope.department) {
      projectWhere.authorDepartment = adminAuth.scope.department;
    }

    where.project = projectWhere;

    // Apply filters
    if (filters.status && filters.status.length > 0) {
      where.status = { in: filters.status };
    }

    if (filters.studentDepartment) {
      where.studentDepartment = filters.studentDepartment;
    }

    if (filters.projectId) {
      where.projectId = filters.projectId;
    }

    if (filters.studentId) {
      where.studentId = filters.studentId;
    }

    if (filters.appliedAfter || filters.appliedBefore) {
      where.appliedAt = {};
      if (filters.appliedAfter) where.appliedAt.gte = filters.appliedAfter;
      if (filters.appliedBefore) where.appliedAt.lte = filters.appliedBefore;
    }

    // Add search functionality
    if (filters.search) {
      where.OR = [
        { studentName: { contains: filters.search, mode: 'insensitive' } },
        { studentEmail: { contains: filters.search, mode: 'insensitive' } },
        { studentDepartment: { contains: filters.search, mode: 'insensitive' } },
        { project: { title: { contains: filters.search, mode: 'insensitive' } } },
        { project: { authorName: { contains: filters.search, mode: 'insensitive' } } }
      ];
    }

    const [applications, total] = await Promise.all([
      prisma.appliedProject.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        include: {
          project: {
            select: {
              id: true,
              title: true,
              authorName: true
            }
          }
        }
      }),
      prisma.appliedProject.count({ where })
    ]);

    return {
      applications: applications.map(app => ({
        ...app,
        project: {
          id: app.project.id,
          title: app.project.title,
          authorName: app.project.authorName
        }
      })),
      pagination: {
        page,
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    };
  }

  /**
   * Get single application with details
   */
  static async getApplicationById(applicationId: string, adminAuth: any) {
    const application = await prisma.appliedProject.findUnique({
      where: { id: applicationId },
      include: {
        project: true
      }
    });

    if (!application) {
      throw new Error('Application not found');
    }

    // Check if admin can manage this application
    if (!canManageApplication(adminAuth, application, application.project)) {
      throw new Error('Access denied');
    }

    return application;
  }

  /**
   * Update application status
   */
  static async updateApplicationStatus(
    applicationId: string,
    statusUpdate: ApplicationStatusUpdate,
    adminAuth: any
  ): Promise<{
    oldStatus: ApplicationStatus;
    newStatus: ApplicationStatus;
    reason?: string;
    application: any;
  }> {
    const application = await this.getApplicationById(applicationId, adminAuth);
    
    const oldStatus = application.status;
    
    const updatedApplication = await prisma.appliedProject.update({
      where: { id: applicationId },
      data: {
        status: statusUpdate.status
      },
      include: {
        project: true
      }
    });

    return {
      oldStatus,
      newStatus: statusUpdate.status,
      reason: statusUpdate.reason,
      application: updatedApplication
    };
  }

  /**
   * Bulk update application statuses with comprehensive validation
   */
  static async bulkUpdateApplicationStatus(
    operation: BulkApplicationOperation,
    adminAuth: any
  ): Promise<BulkOperationResult> {
    if (operation.applicationIds.length > ADMIN_LIMITS.MAX_BULK_OPERATION_SIZE) {
      throw new Error(`Maximum ${ADMIN_LIMITS.MAX_BULK_OPERATION_SIZE} applications allowed per bulk operation`);
    }

    const result: BulkOperationResult = {
      totalProcessed: operation.applicationIds.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Get all applications first to check permissions
    const applications = await prisma.appliedProject.findMany({
      where: { id: { in: operation.applicationIds } },
      include: { project: true }
    });

    for (let i = 0; i < operation.applicationIds.length; i++) {
      try {
        const applicationId = operation.applicationIds[i];
        const application = applications.find(a => a.id === applicationId);

        if (!application) {
          throw new Error('Application not found');
        }

        if (!canManageApplication(adminAuth, application, application.project)) {
          throw new Error('Access denied');
        }

        // Check if application is already in the target status
        if (application.status === operation.status) {
          throw new Error(`Application is already ${operation.status.toLowerCase()}`);
        }

        await prisma.appliedProject.update({
          where: { id: applicationId },
          data: {
            status: operation.status as ApplicationStatus
          }
        });

        result.successful++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          index: i,
          error: error instanceof Error ? error.message : 'Unknown error',
          data: { applicationId: operation.applicationIds[i] }
        });
      }
    }

    return result;
  }

  /**
   * Get application analytics with time range and project filtering
   */
  static async getApplicationAnalytics(adminAuth: any, timeRange: string = '30d', projectId?: string) {
    // Calculate date range
    const now = new Date();
    let startDate: Date;
    
    switch (timeRange) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default: // 30d
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Build where clause for admin scope
    const projectWhere: any = {};
    if (adminAuth.scope.collegeId && !adminAuth.roles.includes("SUPER_ADMIN")) {
      projectWhere.collegeId = adminAuth.scope.collegeId;
    }

    // DEPT_ADMIN can only see applications for projects in their department
    if (adminAuth.roles.includes("DEPT_ADMIN") && adminAuth.scope.department) {
      projectWhere.authorDepartment = adminAuth.scope.department;
    }

    // Add project filter if specified
    if (projectId) {
      projectWhere.id = projectId;
    }

    const applicationWhere: any = {
      project: projectWhere,
      appliedAt: {
        gte: startDate
      }
    };

    const [
      totalApplications,
      applicationsByStatus,
      applicationsByDepartment,
      topAppliedProjects
    ] = await Promise.all([
      // Total applications
      prisma.appliedProject.count({
        where: applicationWhere
      }),

      // Applications by status
      prisma.appliedProject.groupBy({
        by: ['status'],
        where: applicationWhere,
        _count: {
          id: true
        }
      }),

      // Applications by student department
      prisma.appliedProject.groupBy({
        by: ['studentDepartment'],
        where: applicationWhere,
        _count: {
          id: true
        },
        orderBy: {
          _count: {
            id: 'desc'
          }
        },
        take: 10
      }),

      // Top applied projects
      prisma.appliedProject.groupBy({
        by: ['projectId'],
        where: applicationWhere,
        _count: {
          id: true
        },
        orderBy: {
          _count: {
            id: 'desc'
          }
        },
        take: 10
      })
    ]);

    // Get project details for top applied projects
    const projectIds = topAppliedProjects.map(p => p.projectId);
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, title: true }
    });

    const topAppliedProjectsWithDetails = topAppliedProjects.map(p => {
      const project = projects.find(proj => proj.id === p.projectId);
      return {
        projectId: p.projectId,
        projectTitle: project?.title || 'Unknown Project',
        applicationCount: p._count.id
      };
    });

    // Calculate acceptance rate
    const acceptedCount = applicationsByStatus.find(s => s.status === 'ACCEPTED')?._count.id || 0;
    const acceptanceRate = totalApplications > 0 ? (acceptedCount / totalApplications) * 100 : 0;

    return {
      totalApplications,
      applicationsByStatus: this.formatApplicationStatusCounts(applicationsByStatus),
      applicationsByDepartment: this.formatDepartmentCounts(applicationsByDepartment),
      topAppliedProjects: topAppliedProjectsWithDetails,
      acceptanceRate: Math.round(acceptanceRate * 100) / 100
    };
  }

  /**
   * Format application status counts for consistent response
   */
  private static formatApplicationStatusCounts(statusCounts: any[]) {
    const formatted = {
      pending: 0,
      accepted: 0,
      rejected: 0
    };

    statusCounts.forEach(item => {
      switch (item.status) {
        case 'PENDING':
          formatted.pending = item._count.id;
          break;
        case 'ACCEPTED':
          formatted.accepted = item._count.id;
          break;
        case 'REJECTED':
          formatted.rejected = item._count.id;
          break;
      }
    });

    return formatted;
  }

  /**
   * Format department counts for consistent response
   */
  private static formatDepartmentCounts(departmentCounts: any[]) {
    return departmentCounts.map(item => ({
      department: item.studentDepartment,
      count: item._count.id
    }));
  }

  /**
   * Get applications for export with enhanced student data
   */
  static async getApplicationsForExport(filters: any, adminAuth: any, authHeader: string) {
    // Build where clause
    const where: any = {};

    // Apply admin scope through project relationship
    const projectWhere: any = {};
    if (adminAuth.scope.collegeId && !adminAuth.roles.includes("SUPER_ADMIN")) {
      projectWhere.collegeId = adminAuth.scope.collegeId;
    }

    // DEPT_ADMIN can only see applications for projects in their department
    if (adminAuth.roles.includes("DEPT_ADMIN") && adminAuth.scope.department) {
      projectWhere.authorDepartment = adminAuth.scope.department;
    }

    where.project = projectWhere;

    // Apply filters
    if (filters.status && filters.status.length > 0) {
      where.status = { in: filters.status };
    }

    if (filters.studentDepartment) {
      where.studentDepartment = filters.studentDepartment;
    }

    if (filters.projectId) {
      where.projectId = filters.projectId;
    }

    const applications = await prisma.appliedProject.findMany({
      where,
      orderBy: { appliedAt: 'desc' },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            authorName: true
          }
        }
      },
      take: 10000 // Reasonable limit for export
    });

    // Fetch complete user data for each application
    const enrichedApplications = await Promise.all(
      applications.map(async (app) => {
        try {
          // Fetch user details from auth service using the passed auth header
          const userIdentity = await getUserIdentity(app.studentId, authHeader);
          
          return {
            ...app,
            studentEmail: userIdentity?.email || 'N/A',
            studentRegistrationNumber: userIdentity?.collegeMemberId || 'N/A',
            studentYear: userIdentity?.year?.toString() || 'N/A'
          };
        } catch (error) {
          console.error(`Failed to fetch user data for ${app.studentId}:`, error);
          return {
            ...app,
            studentEmail: 'N/A',
            studentRegistrationNumber: 'N/A', 
            studentYear: 'N/A'
          };
        }
      })
    );

    return enrichedApplications;
  }
}
