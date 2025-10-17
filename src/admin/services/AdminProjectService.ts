import { prisma } from '../../db';
import { 
  ProjectFilters, 
  PaginationParams, 
  ProjectModerationRequest,
  BulkProjectOperation,
  BulkOperationResult,
  ADMIN_LIMITS
} from '../types/adminTypes';
import { canModerateProject } from '../middleware/adminAuth';

export class AdminProjectService {
  /**
   * Get projects with filtering and admin scope
   */
  static async getProjects(
    filters: ProjectFilters,
    pagination: PaginationParams,
    adminAuth: any
  ) {
    const { page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
    const skip = (page - 1) * limit;
    const take = Math.min(limit, 100);

    // Build where clause with admin scope
    const where: any = {
      archivedAt: null
    };

    // Apply admin scope
    if (adminAuth.scope.collegeId && !adminAuth.roles.includes("SUPER_ADMIN")) {
      where.collegeId = adminAuth.scope.collegeId;
    }

    // DEPT_ADMIN can only see projects from their department
    if (adminAuth.roles.includes("DEPT_ADMIN") && adminAuth.scope.department) {
      where.authorDepartment = adminAuth.scope.department;
    }

    // Apply filters
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { tags: { hasSome: [filters.search] } },
        { skills: { hasSome: [filters.search] } }
      ];
    }

    if (filters.moderationStatus && filters.moderationStatus.length > 0) {
      where.moderationStatus = { in: filters.moderationStatus };
    }

    if (filters.progressStatus && filters.progressStatus.length > 0) {
      where.progressStatus = { in: filters.progressStatus };
    }

    if (filters.projectType && filters.projectType.length > 0) {
      where.projectType = { in: filters.projectType };
    }

    if (filters.department) {
      where.authorDepartment = filters.department;
    }

    if (filters.authorId) {
      where.authorId = filters.authorId;
    }

    if (filters.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags };
    }

    if (filters.skills && filters.skills.length > 0) {
      where.skills = { hasSome: filters.skills };
    }

    if (filters.createdAfter || filters.createdBefore) {
      where.createdAt = {};
      if (filters.createdAfter) where.createdAt.gte = filters.createdAfter;
      if (filters.createdBefore) where.createdAt.lte = filters.createdBefore;
    }

    if (filters.deadlineAfter || filters.deadlineBefore) {
      where.deadline = {};
      if (filters.deadlineAfter) where.deadline.gte = filters.deadlineAfter;
      if (filters.deadlineBefore) where.deadline.lte = filters.deadlineBefore;
    }

    // Handle overdue projects
    if (filters.isOverdue) {
      where.deadline = { lt: new Date() };
      where.progressStatus = { not: 'COMPLETED' };
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
        include: {
          applications: {
            select: {
              id: true,
              studentId: true,
              studentName: true,
              studentDepartment: true,
              status: true,
              appliedAt: true
            }
          },
          _count: {
            select: {
              applications: true,
              comments: true,
              tasks: true
            }
          }
        }
      }),
      prisma.project.count({ where })
    ]);

    // Add computed fields
    const enrichedProjects = projects.map(project => ({
      ...project,
      applicationCount: project._count.applications,
      commentCount: project._count.comments,
      taskCount: project._count.tasks,
      isOverdue: project.deadline ? new Date(project.deadline) < new Date() && project.progressStatus !== 'COMPLETED' : false,
      capacityStatus: this.getCapacityStatus(project.applications.length, project.maxStudents)
    }));

    return {
      projects: enrichedProjects,
      pagination: {
        page,
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    };
  }

  /**
   * Get single project with full details
   */
  static async getProjectById(projectId: string, adminAuth: any) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        applications: {
          include: {
            // Would include student details from auth service
          },
          orderBy: { appliedAt: 'desc' }
        },
        tasks: {
          orderBy: { createdAt: 'desc' }
        },
        attachments: {
          orderBy: { createdAt: 'desc' }
        },
        comments: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Check if admin can access this project
    if (!canModerateProject(adminAuth, project)) {
      throw new Error('Access denied');
    }

    return {
      ...project,
      isOverdue: project.deadline ? new Date(project.deadline) < new Date() && project.progressStatus !== 'COMPLETED' : false,
      capacityStatus: this.getCapacityStatus(project.applications.length, project.maxStudents)
    };
  }

  /**
   * Get single project (alias for getProjectById for consistency)
   */
  static async getProject(projectId: string, adminAuth: any) {
    return this.getProjectById(projectId, adminAuth);
  }

  /**
   * Update project
   */
  static async updateProject(projectId: string, updateData: any, adminAuth: any) {
    // Verify project exists and admin has access
    const existingProject = await this.getProjectById(projectId, adminAuth);
    if (!existingProject) {
      throw new Error('Project not found or access denied');
    }

    // For DEPT_ADMIN, ensure they can only update projects from their department
    if (adminAuth.roles.includes("DEPT_ADMIN")) {
      if (existingProject.authorDepartment !== adminAuth.scope.department) {
        throw new Error('Cannot update project from different department');
      }
    }

    // Update the project
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...updateData,
        updatedAt: new Date()
      },
      include: {
        applications: {
          select: {
            id: true,
            studentId: true,
            studentName: true,
            studentDepartment: true,
            status: true,
            appliedAt: true
          }
        },
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            assignedToId: true,
            createdAt: true
          }
        },
        comments: {
          select: {
            id: true,
            authorId: true,
            authorName: true,
            body: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        _count: {
          select: {
            applications: true,
            tasks: true,
            comments: true
          }
        }
      }
    });

    return {
      ...updatedProject,
      applicationCount: updatedProject._count.applications,
      taskCount: updatedProject._count.tasks,
      commentCount: updatedProject._count.comments,
      isOverdue: updatedProject.deadline ? new Date() > updatedProject.deadline : false,
      capacityStatus: updatedProject._count.applications >= updatedProject.maxStudents ? 'FULL' : 'AVAILABLE'
    };
  }

  /**
   * Moderate project (approve, reject, archive)
   */
  static async moderateProject(
    projectId: string,
    moderation: ProjectModerationRequest,
    adminAuth: any
  ) {
    const currentProject = await prisma.project.findUnique({
      where: { id: projectId }
    });

    if (!currentProject) {
      throw new Error('Project not found');
    }

    if (!canModerateProject(adminAuth, currentProject)) {
      throw new Error('Access denied');
    }

    let updateData: any = {};
    
    switch (moderation.action) {
      case 'APPROVE':
        updateData.moderationStatus = 'APPROVED';
        break;
      case 'REJECT':
        updateData.moderationStatus = 'REJECTED';
        break;
      case 'ARCHIVE':
        updateData.archivedAt = new Date();
        break;
    }

    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: updateData
    });

    return {
      oldProject: currentProject,
      newProject: updatedProject,
      action: moderation.action,
      reason: moderation.reason
    };
  }

  /**
   * Bulk project operations
   */
  static async bulkProjectOperation(
    operation: BulkProjectOperation,
    adminAuth: any
  ): Promise<BulkOperationResult> {
    if (operation.projectIds.length > ADMIN_LIMITS.MAX_BULK_OPERATION_SIZE) {
      throw new Error(`Maximum ${ADMIN_LIMITS.MAX_BULK_OPERATION_SIZE} projects allowed per bulk operation`);
    }

    const result: BulkOperationResult = {
      totalProcessed: operation.projectIds.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Get all projects first to check permissions
    const projects = await prisma.project.findMany({
      where: { id: { in: operation.projectIds } }
    });

    for (let i = 0; i < operation.projectIds.length; i++) {
      try {
        const projectId = operation.projectIds[i];
        const project = projects.find(p => p.id === projectId);

        if (!project) {
          throw new Error('Project not found');
        }

        if (!canModerateProject(adminAuth, project)) {
          throw new Error('Access denied');
        }

        let updateData: any = {};
        
        switch (operation.action) {
          case 'APPROVE':
            updateData.moderationStatus = 'APPROVED';
            break;
          case 'REJECT':
            updateData.moderationStatus = 'REJECTED';
            break;
          case 'ARCHIVE':
            updateData.archivedAt = new Date();
            break;
          case 'STATUS_UPDATE':
            if (operation.progressStatus) {
              updateData.progressStatus = operation.progressStatus;
            }
            break;
        }

        await prisma.project.update({
          where: { id: projectId },
          data: updateData
        });

        result.successful++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          index: i,
          error: error instanceof Error ? error.message : 'Unknown error',
          data: { projectId: operation.projectIds[i] }
        });
      }
    }

    return result;
  }

  /**
   * Get project analytics
   */
  static async getProjectAnalytics(adminAuth: any, timeRange: string = '30d') {
    const collegeScope = adminAuth.scope.collegeId;
    const departmentScope = adminAuth.roles.includes("DEPT_ADMIN") ? adminAuth.scope.department : null;

    // Build base where clause
    const where: any = {
      archivedAt: null // Exclude archived projects from analytics
    };
    if (collegeScope && !adminAuth.roles.includes("SUPER_ADMIN")) {
      where.collegeId = collegeScope;
    }
    if (departmentScope) {
      where.authorDepartment = departmentScope;
    }

    // Add time range filter
    const timeRangeDate = this.getTimeRangeDate(timeRange);
    if (timeRangeDate) {
      where.createdAt = { gte: timeRangeDate };
    }

    const [
      totalProjects,
      projectsByStatus,
      projectsByType,
      projectsByDepartment,
      applicationStats,
      engagementMetrics
    ] = await Promise.all([
      // Total projects
      prisma.project.count({ where }),

      // Projects by moderation status
      prisma.project.groupBy({
        by: ['moderationStatus'],
        where,
        _count: { moderationStatus: true }
      }),

      // Projects by type
      prisma.project.groupBy({
        by: ['projectType'],
        where,
        _count: { projectType: true }
      }),

      // Projects by department (if HEAD_ADMIN or SUPER_ADMIN)
      !departmentScope ? prisma.project.groupBy({
        by: ['authorDepartment'],
        where,
        _count: { authorDepartment: true }
      }) : Promise.resolve([]),

      // Application statistics
      this.getApplicationStats(where),

      // Engagement metrics
      this.getEngagementMetrics(where)
    ]);

    return {
      totalProjects,
      projectsByStatus: this.formatStatusCounts(projectsByStatus),
      projectsByType: this.formatTypeCounts(projectsByType),
      projectsByDepartment: this.formatDepartmentCounts(projectsByDepartment),
      applicationStats,
      engagementMetrics
    };
  }

  // Private helper methods
  private static getCapacityStatus(applicationCount: number, maxStudents: number): string {
    if (applicationCount >= maxStudents) return 'full';
    if (applicationCount === 0) return 'empty';
    return 'available';
  }

  private static getTimeRangeDate(timeRange: string): Date | null {
    const now = new Date();
    switch (timeRange) {
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      case '1y':
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      default:
        return null;
    }
  }

  private static async getApplicationStats(where: any) {
    const projects = await prisma.project.findMany({
      where,
      include: {
        applications: true
      }
    });

    const totalApplications = projects.reduce((sum, p) => sum + p.applications.length, 0);
    const acceptedApplications = projects.reduce((sum, p) => 
      sum + p.applications.filter(a => a.status === 'ACCEPTED').length, 0);

    return {
      totalApplications,
      acceptanceRate: totalApplications > 0 ? (acceptedApplications / totalApplications) * 100 : 0,
      averageApplicationsPerProject: projects.length > 0 ? totalApplications / projects.length : 0
    };
  }

  private static async getEngagementMetrics(where: any) {
    const [activeProjects, completedProjects] = await Promise.all([
      prisma.project.count({
        where: { ...where, progressStatus: { in: ['OPEN', 'IN_PROGRESS'] } }
      }),
      prisma.project.count({
        where: { ...where, progressStatus: 'COMPLETED' }
      })
    ]);

    const totalProjects = activeProjects + completedProjects;
    const completionRate = totalProjects > 0 ? (completedProjects / totalProjects) * 100 : 0;

    return {
      activeProjects,
      completionRate,
      averageProjectDuration: 0 // Would calculate based on created/completed dates
    };
  }

  private static formatStatusCounts(statusCounts: any[]) {
    const result = { pending: 0, approved: 0, rejected: 0, completed: 0 };
    statusCounts.forEach(item => {
      switch (item.moderationStatus) {
        case 'PENDING_APPROVAL':
          result.pending = item._count.moderationStatus;
          break;
        case 'APPROVED':
          result.approved = item._count.moderationStatus;
          break;
        case 'REJECTED':
          result.rejected = item._count.moderationStatus;
          break;
      }
    });
    return result;
  }

  private static formatTypeCounts(typeCounts: any[]) {
    const result: Record<string, number> = {};
    typeCounts.forEach(item => {
      result[item.projectType] = item._count.projectType;
    });
    return result;
  }

  private static formatDepartmentCounts(deptCounts: any[]) {
    const result: Record<string, number> = {};
    deptCounts.forEach(item => {
      if (item.authorDepartment) {
        result[item.authorDepartment] = item._count.authorDepartment;
      }
    });
    return result;
  }
}
