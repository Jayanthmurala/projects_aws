import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminProjectService } from '../services/AdminProjectService';
import { AdminApplicationService } from '../services/AdminApplicationService';
import { AuditLogger } from '../utils/auditLogger';
import { 
  ProjectFilters, 
  PaginationParams, 
  ProjectModerationRequest,
  ApplicationStatusUpdate,
  BulkApplicationOperation,
  AdminResponse 
} from '../types/adminTypes';

export class DeptAdminController {
  /**
   * Get DEPT_ADMIN dashboard data
   */
  static async getDashboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const department = adminAuth.scope.department;

      const [
        departmentProjects,
        departmentApplications,
        recentProjects
      ] = await Promise.all([
        AdminProjectService.getProjectAnalytics(adminAuth),
        AdminApplicationService.getApplicationAnalytics(adminAuth),
        AdminProjectService.getProjects(
          { department, moderationStatus: ['PENDING_APPROVAL'] },
          { page: 1, limit: 5, sortBy: 'createdAt', sortOrder: 'desc' },
          adminAuth
        )
      ]);

      await AuditLogger.logLogin(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: {
          department,
          projectAnalytics: departmentProjects,
          applicationAnalytics: departmentApplications,
          recentProjects: recentProjects.projects,
          summary: {
            totalProjects: departmentProjects.totalProjects,
            pendingApproval: departmentProjects.projectsByStatus.pending,
            totalApplications: departmentApplications.totalApplications,
            departmentFocus: true
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
   * Get enum values for dropdowns and filters
   */
  static async getEnums(request: FastifyRequest, reply: FastifyReply) {
    try {
      const response: AdminResponse = {
        success: true,
        data: {
          projectTypes: ['PROJECT', 'RESEARCH', 'PAPER_PUBLISH', 'OTHER'],
          moderationStatuses: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
          progressStatuses: ['OPEN', 'IN_PROGRESS', 'COMPLETED'],
          applicationStatuses: ['PENDING', 'ACCEPTED', 'REJECTED'],
          taskStatuses: ['TODO', 'IN_PROGRESS', 'DONE'],
          sortOptions: [
            { value: 'createdAt', label: 'Date Created' },
            { value: 'updatedAt', label: 'Last Updated' },
            { value: 'title', label: 'Title' }
          ],
          sortOrders: [
            { value: 'desc', label: 'Newest First' },
            { value: 'asc', label: 'Oldest First' }
          ]
        }
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load enums'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get department projects with filtering and pagination
   */
  static async getProjects(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const query = request.query as any;

      // Force department filter for DEPT_ADMIN
      const filters: ProjectFilters = {
        search: query.search,
        department: adminAuth.scope.department, // Always filter by admin's department
        moderationStatus: query.moderationStatus ? query.moderationStatus.split(',') : undefined,
        progressStatus: query.progressStatus ? query.progressStatus.split(',') : undefined,
        projectType: query.projectType ? query.projectType.split(',') : undefined,
        authorId: query.authorId,
        tags: query.tags ? query.tags.split(',') : undefined,
        skills: query.skills ? query.skills.split(',') : undefined,
        isOverdue: query.isOverdue === 'true',
        createdAfter: query.createdAfter ? new Date(query.createdAfter) : undefined,
        createdBefore: query.createdBefore ? new Date(query.createdBefore) : undefined
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
   * Get single project (department-scoped)
   */
  static async getProject(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { projectId } = request.params as { projectId: string };

      const project = await AdminProjectService.getProjectById(projectId, adminAuth);

      // Additional check for department scope
      if (project.authorDepartment !== adminAuth.scope.department) {
        const response: AdminResponse = {
          success: false,
          message: 'Access denied: Project not in your department'
        };
        return reply.status(403).send(response);
      }

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
   * Update department project (author must be from same department)
   */
  static async updateProject(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { projectId } = request.params as { projectId: string };
      const updateData = request.body as any;

      // Validate projectId parameter
      if (!projectId || typeof projectId !== 'string') {
        const response: AdminResponse = {
          success: false,
          message: 'Invalid project ID'
        };
        return reply.status(400).send(response);
      }

      // Basic validation of update data
      if (updateData && typeof updateData !== 'object') {
        const response: AdminResponse = {
          success: false,
          message: 'Invalid request body'
        };
        return reply.status(400).send(response);
      }

      // Validate specific fields if provided
      const validatedData: any = {};
      if (updateData.title !== undefined) {
        if (typeof updateData.title !== 'string' || updateData.title.trim().length === 0) {
          const response: AdminResponse = {
            success: false,
            message: 'Title must be a non-empty string'
          };
          return reply.status(400).send(response);
        }
        validatedData.title = updateData.title.trim();
      }

      if (updateData.description !== undefined) {
        if (typeof updateData.description !== 'string' || updateData.description.trim().length === 0) {
          const response: AdminResponse = {
            success: false,
            message: 'Description must be a non-empty string'
          };
          return reply.status(400).send(response);
        }
        validatedData.description = updateData.description.trim();
      }

      if (updateData.projectType !== undefined) {
        const validTypes = ['PROJECT', 'RESEARCH', 'PAPER_PUBLISH', 'OTHER'];
        if (!validTypes.includes(updateData.projectType)) {
          const response: AdminResponse = {
            success: false,
            message: `Project type must be one of: ${validTypes.join(', ')}`
          };
          return reply.status(400).send(response);
        }
        validatedData.projectType = updateData.projectType;
      }

      if (updateData.maxStudents !== undefined) {
        if (!Number.isInteger(updateData.maxStudents) || updateData.maxStudents < 1) {
          const response: AdminResponse = {
            success: false,
            message: 'Max students must be a positive integer'
          };
          return reply.status(400).send(response);
        }
        validatedData.maxStudents = updateData.maxStudents;
      }

      if (updateData.progressStatus !== undefined) {
        const validStatuses = ['OPEN', 'IN_PROGRESS', 'COMPLETED'];
        if (!validStatuses.includes(updateData.progressStatus)) {
          const response: AdminResponse = {
            success: false,
            message: `Progress status must be one of: ${validStatuses.join(', ')}`
          };
          return reply.status(400).send(response);
        }
        validatedData.progressStatus = updateData.progressStatus;
      }

      // Handle deadline field with proper datetime conversion
      if (updateData.deadline !== undefined) {
        if (updateData.deadline === null || updateData.deadline === '') {
          validatedData.deadline = null;
        } else {
          try {
            // Convert to proper ISO-8601 DateTime format
            const deadlineDate = new Date(updateData.deadline);
            if (isNaN(deadlineDate.getTime())) {
              const response: AdminResponse = {
                success: false,
                message: 'Invalid deadline format. Please provide a valid date.'
              };
              return reply.status(400).send(response);
            }
            validatedData.deadline = deadlineDate.toISOString();
          } catch (error) {
            const response: AdminResponse = {
              success: false,
              message: 'Invalid deadline format. Please provide a valid date.'
            };
            return reply.status(400).send(response);
          }
        }
      }

      // Copy other valid fields
      ['projectDuration', 'skills', 'tags', 'requirements', 'outcomes', 'departments', 'visibleToAllDepts'].forEach(field => {
        if (updateData[field] !== undefined) {
          validatedData[field] = updateData[field];
        }
      });

      // First, verify the project exists and is from the admin's department
      const existingProject = await AdminProjectService.getProject(projectId, adminAuth);
      if (!existingProject) {
        const response: AdminResponse = {
          success: false,
          message: 'Project not found or access denied'
        };
        return reply.status(404).send(response);
      }

      // Verify the project author is from the same department
      if (existingProject.authorDepartment !== adminAuth.scope.department) {
        const response: AdminResponse = {
          success: false,
          message: 'Can only update projects from your department'
        };
        return reply.status(403).send(response);
      }

      // Update the project with validated data
      const updatedProject = await AdminProjectService.updateProject(projectId, validatedData, adminAuth);

      await AuditLogger.logProjectUpdate(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        projectId,
        existingProject,
        updatedProject,
        validatedData,
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: updatedProject,
        message: 'Project updated successfully'
      };

      return reply.status(200).send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update project'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Moderate department project (limited actions)
   */
  static async moderateProject(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { projectId } = request.params as { projectId: string };
      const moderation = request.body as ProjectModerationRequest;

      // DEPT_ADMIN can only approve projects, not reject or archive
      if (moderation.action !== 'APPROVE') {
        const response: AdminResponse = {
          success: false,
          message: 'Department Admin can only approve projects. Contact Head Admin for other actions.'
        };
        return reply.status(403).send(response);
      }

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
   * Get department applications with comprehensive filtering and validation
   */
  static async getApplications(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const query = request.query as any;

      // Validate and sanitize query parameters
      const page = Math.max(1, parseInt(query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
      
      // Build filters with proper validation
      const filters: any = {};
      
      // Status filter
      if (query.status && ['PENDING', 'ACCEPTED', 'REJECTED'].includes(query.status)) {
        filters.status = [query.status];
      }
      
      // Project filter
      if (query.projectId && typeof query.projectId === 'string') {
        filters.projectId = query.projectId.trim();
      }
      
      // Student filters
      if (query.studentId && typeof query.studentId === 'string') {
        filters.studentId = query.studentId.trim();
      }
      
      if (query.studentDepartment && typeof query.studentDepartment === 'string') {
        filters.studentDepartment = query.studentDepartment.trim();
      }
      
      // Search filter
      if (query.search && typeof query.search === 'string' && query.search.trim().length > 0) {
        filters.search = query.search.trim();
      }
      
      // Date filters
      if (query.appliedAfter) {
        const date = new Date(query.appliedAfter);
        if (!isNaN(date.getTime())) {
          filters.appliedAfter = date;
        }
      }
      
      if (query.appliedBefore) {
        const date = new Date(query.appliedBefore);
        if (!isNaN(date.getTime())) {
          filters.appliedBefore = date;
        }
      }

      // Pagination and sorting
      const sortBy = ['appliedAt', 'status', 'studentName'].includes(query.sortBy) 
        ? query.sortBy : 'appliedAt';
      const sortOrder = ['asc', 'desc'].includes(query.sortOrder) 
        ? query.sortOrder : 'desc';

      const pagination = { page, limit, sortBy, sortOrder };

      // Get applications with admin scope validation
      const result = await AdminApplicationService.getApplications(filters, pagination, adminAuth);

      const response: AdminResponse = {
        success: true,
        data: result.applications,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      console.error('Error in getApplications:', error);
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch applications'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get single application with detailed information and access control
   */
  static async getApplication(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { applicationId } = request.params as { applicationId: string };

      // Validate application ID format
      if (!applicationId || typeof applicationId !== 'string' || applicationId.trim().length === 0) {
        const response: AdminResponse = {
          success: false,
          message: 'Invalid application ID'
        };
        return reply.status(400).send(response);
      }

      const application = await AdminApplicationService.getApplicationById(applicationId.trim(), adminAuth);

      if (!application) {
        const response: AdminResponse = {
          success: false,
          message: 'Application not found or access denied'
        };
        return reply.status(404).send(response);
      }

      const response: AdminResponse = {
        success: true,
        data: application
      };

      return reply.send(response);
    } catch (error) {
      console.error('Error in getApplication:', error);
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get application'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Update application status with comprehensive validation and audit logging
   */
  static async updateApplicationStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { applicationId } = request.params as { applicationId: string };
      const body = request.body as any;

      // Validate application ID
      if (!applicationId || typeof applicationId !== 'string' || applicationId.trim().length === 0) {
        const response: AdminResponse = {
          success: false,
          message: 'Invalid application ID'
        };
        return reply.status(400).send(response);
      }

      // Validate request body
      if (!body || typeof body !== 'object') {
        const response: AdminResponse = {
          success: false,
          message: 'Invalid request body'
        };
        return reply.status(400).send(response);
      }

      // Validate status
      const validStatuses = ['ACCEPTED', 'REJECTED'];
      if (!body.status || !validStatuses.includes(body.status)) {
        const response: AdminResponse = {
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        };
        return reply.status(400).send(response);
      }

      // Validate reason
      if (!body.reason || typeof body.reason !== 'string' || body.reason.trim().length === 0) {
        const response: AdminResponse = {
          success: false,
          message: 'Reason is required and must be a non-empty string'
        };
        return reply.status(400).send(response);
      }

      if (body.reason.length > 500) {
        const response: AdminResponse = {
          success: false,
          message: 'Reason must be 500 characters or less'
        };
        return reply.status(400).send(response);
      }

      // Validate feedback if provided
      if (body.feedback && (typeof body.feedback !== 'string' || body.feedback.length > 1000)) {
        const response: AdminResponse = {
          success: false,
          message: 'Feedback must be a string of 1000 characters or less'
        };
        return reply.status(400).send(response);
      }

      const statusUpdate: ApplicationStatusUpdate = {
        status: body.status,
        reason: body.reason.trim(),
        feedback: body.feedback ? body.feedback.trim() : undefined
      };

      // Update application status
      const result = await AdminApplicationService.updateApplicationStatus(
        applicationId.trim(), 
        statusUpdate, 
        adminAuth
      );

      // Log the action for audit trail
      await AuditLogger.logApplicationStatusChange(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        applicationId,
        result.oldStatus,
        result.newStatus,
        statusUpdate.reason,
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: {
          id: applicationId,
          status: result.newStatus,
          updatedAt: new Date().toISOString()
        },
        message: `Application ${result.newStatus.toLowerCase()} successfully`
      };

      return reply.send(response);
    } catch (error) {
      console.error('Error in updateApplicationStatus:', error);
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update application status'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Bulk update application statuses with validation and error handling
   */
  static async bulkUpdateApplicationStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const body = request.body as any;

      // Validate request body
      if (!body || typeof body !== 'object') {
        const response: AdminResponse = {
          success: false,
          message: 'Invalid request body'
        };
        return reply.status(400).send(response);
      }

      // Validate application IDs
      if (!Array.isArray(body.applicationIds) || body.applicationIds.length === 0) {
        const response: AdminResponse = {
          success: false,
          message: 'Application IDs must be a non-empty array'
        };
        return reply.status(400).send(response);
      }

      if (body.applicationIds.length > 50) {
        const response: AdminResponse = {
          success: false,
          message: 'Cannot process more than 50 applications at once'
        };
        return reply.status(400).send(response);
      }

      // Validate each application ID
      const validApplicationIds = body.applicationIds.filter((id: any) => 
        typeof id === 'string' && id.trim().length > 0
      );

      if (validApplicationIds.length !== body.applicationIds.length) {
        const response: AdminResponse = {
          success: false,
          message: 'All application IDs must be valid non-empty strings'
        };
        return reply.status(400).send(response);
      }

      // Check for duplicates
      const uniqueIds = [...new Set(validApplicationIds)];
      if (uniqueIds.length !== validApplicationIds.length) {
        const response: AdminResponse = {
          success: false,
          message: 'Duplicate application IDs are not allowed'
        };
        return reply.status(400).send(response);
      }

      // Validate status
      const validStatuses = ['ACCEPTED', 'REJECTED'];
      if (!body.status || !validStatuses.includes(body.status)) {
        const response: AdminResponse = {
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        };
        return reply.status(400).send(response);
      }

      // Validate reason
      if (!body.reason || typeof body.reason !== 'string' || body.reason.trim().length === 0) {
        const response: AdminResponse = {
          success: false,
          message: 'Reason is required and must be a non-empty string'
        };
        return reply.status(400).send(response);
      }

      if (body.reason.length > 500) {
        const response: AdminResponse = {
          success: false,
          message: 'Reason must be 500 characters or less'
        };
        return reply.status(400).send(response);
      }

      // Validate feedback if provided
      if (body.feedback && (typeof body.feedback !== 'string' || body.feedback.length > 1000)) {
        const response: AdminResponse = {
          success: false,
          message: 'Feedback must be a string of 1000 characters or less'
        };
        return reply.status(400).send(response);
      }

      const bulkOperation: BulkApplicationOperation = {
        applicationIds: uniqueIds as string[],
        status: body.status as 'ACCEPTED' | 'REJECTED',
        reason: body.reason.trim(),
        feedback: body.feedback ? body.feedback.trim() : undefined
      };

      // Perform bulk update
      const result = await AdminApplicationService.bulkUpdateApplicationStatus(bulkOperation, adminAuth);

      // Log bulk operation for audit trail
      await AuditLogger.logBulkApplicationUpdate(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        bulkOperation,
        result,
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: result,
        message: `Bulk update completed: ${result.successful} successful, ${result.failed} failed`
      };

      return reply.send(response);
    } catch (error) {
      console.error('Error in bulkUpdateApplicationStatus:', error);
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to perform bulk update'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get application statistics for department projects
   */
  static async getApplicationStats(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const query = request.query as any;

      // Validate time range
      const validTimeRanges = ['7d', '30d', '90d', '1y'];
      const timeRange = validTimeRanges.includes(query.timeRange) ? query.timeRange : '30d';

      // Validate project ID if provided
      let projectId: string | undefined;
      if (query.projectId && typeof query.projectId === 'string' && query.projectId.trim().length > 0) {
        projectId = query.projectId.trim();
      }

      // Get application analytics
      const stats = await AdminApplicationService.getApplicationAnalytics(adminAuth, timeRange, projectId);

      const response: AdminResponse = {
        success: true,
        data: stats
      };

      return reply.send(response);
    } catch (error) {
      console.error('Error in getApplicationStats:', error);
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get application statistics'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get department analytics
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
          // Combined analytics for department
          const [projectAnalytics, applicationAnalytics] = await Promise.all([
            AdminProjectService.getProjectAnalytics(adminAuth, timeRange),
            AdminApplicationService.getApplicationAnalytics(adminAuth, timeRange)
          ]);
          analyticsData = { 
            projects: projectAnalytics, 
            applications: applicationAnalytics,
            department: adminAuth.scope.department
          };
      }

      await AuditLogger.logAnalyticsView(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        `dept_${type || 'combined'}`,
        { timeRange, department: adminAuth.scope.department },
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
   * Export department data
   */
  static async exportData(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { type, format } = request.query as { type: string; format?: string };
      const department = adminAuth.scope.department;

      let csvContent: string;
      let filename: string;

      switch (type) {
        case 'projects':
          // Build filters from query parameters
          const projectFilters: any = {};
          
          // Always include department scope for dept admin
          if (adminAuth.roles.includes("DEPT_ADMIN") && adminAuth.scope.department) {
            projectFilters.department = adminAuth.scope.department;
          }
          
          // Add filters from query parameters
          const { moderationStatus, projectType, search } = request.query as any;
          
          if (moderationStatus) {
            projectFilters.moderationStatus = moderationStatus.split(',');
          }
          if (projectType) {
            projectFilters.projectType = projectType.split(',');
          }
          if (search) {
            projectFilters.search = search;
          }
          
          const projects = await AdminProjectService.getProjects(
            projectFilters,
            { page: 1, limit: 10000, sortBy: 'createdAt', sortOrder: 'desc' },
            adminAuth
          );

          const projectHeaders = [
            'Title', 
            'Author Name', 
            'Author Email',
            'Author Reg No',
            'Department',
            'Project Type', 
            'Moderation Status', 
            'Progress Status', 
            'Total Applications', 
            'Skills',
            'Created Date',
            'Updated Date'
          ];
          
          // Get detailed author information for each project
          const projectRows = await Promise.all(
            projects.projects.map(async (project) => {
              try {
                // Fetch author details from auth service
                const { getUserIdentity } = await import('../../clients/auth');
                const authHeader = request.headers.authorization || '';
                const authorData = await getUserIdentity(project.authorId, authHeader);
                
                return [
                  project.title,
                  authorData.displayName || project.authorName,
                  authorData.email || 'N/A',
                  authorData.collegeMemberId || 'N/A',
                  authorData.department || project.authorDepartment,
                  project.projectType,
                  project.moderationStatus,
                  project.progressStatus,
                  project.applicationCount || 0,
                  Array.isArray(project.skills) ? project.skills.join('; ') : 'N/A',
                  project.createdAt.toISOString().split('T')[0],
                  project.updatedAt.toISOString().split('T')[0]
                ];
              } catch (error) {
                console.error(`Error fetching author data for ${project.authorId}:`, error);
                // Fallback to basic data if auth service fails
                return [
                  project.title,
                  project.authorName,
                  'N/A',
                  'N/A',
                  project.authorDepartment,
                  project.projectType,
                  project.moderationStatus,
                  project.progressStatus,
                  project.applicationCount || 0,
                  Array.isArray(project.skills) ? project.skills.join('; ') : 'N/A',
                  project.createdAt.toISOString().split('T')[0],
                  project.updatedAt.toISOString().split('T')[0]
                ];
              }
            })
          );

          csvContent = [
            projectHeaders.join(','),
            ...projectRows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
          ].join('\n');

          filename = `dept-projects-${department}-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        case 'applications':
          // Build filters from query parameters for applications
          const applicationFilters: any = {};
          
          // Add filters from query parameters
          const { status: appStatus, search: appSearch, projectId: appProjectId } = request.query as any;
          
          if (appStatus) {
            applicationFilters.status = appStatus.split(',');
          }
          if (appSearch) {
            applicationFilters.search = appSearch;
          }
          if (appProjectId) {
            applicationFilters.projectId = appProjectId;
          }
          
          // Get all applications for projects in this department (regardless of student department)
          const applications = await AdminApplicationService.getApplications(
            applicationFilters, // Apply filters from query parameters
            { page: 1, limit: 10000, sortBy: 'appliedAt', sortOrder: 'desc' },
            adminAuth
          );

          // Enhanced headers with email and registration number
          const appHeaders = [
            'Student Name', 
            'Email', 
            'Registration No', 
            'Department', 
            'Year', 
            'Project Title', 
            'Status', 
            'Applied Date',
            'Message'
          ];
          
          // Get detailed student information for each application
          const appRows = await Promise.all(
            applications.applications.map(async (app) => {
              try {
                // Fetch student details from auth service
                const { getUserIdentity } = await import('../../clients/auth');
                const authHeader = request.headers.authorization || '';
                const studentData = await getUserIdentity(app.studentId, authHeader);
                
                return [
                  studentData.displayName || app.studentName,
                  studentData.email || 'N/A',
                  studentData.collegeMemberId || 'N/A',
                  studentData.department || app.studentDepartment,
                  studentData.year || 'N/A',
                  app.project.title,
                  app.status,
                  app.appliedAt.toISOString().split('T')[0],
                  app.message || 'N/A'
                ];
              } catch (error) {
                console.error(`Error fetching student data for ${app.studentId}:`, error);
                // Fallback to basic data if auth service fails
                return [
                  app.studentName,
                  'N/A',
                  'N/A', 
                  app.studentDepartment,
                  'N/A',
                  app.project.title,
                  app.status,
                  app.appliedAt.toISOString().split('T')[0],
                  app.message || 'N/A'
                ];
              }
            })
          );

          csvContent = [
            appHeaders.join(','),
            ...appRows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
          ].join('\n');

          filename = `dept-applications-${department}-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        case 'project-applications':
          // Export applications for a specific project
          const { projectId } = request.query as { projectId?: string };
          if (!projectId) {
            throw new Error('Project ID is required for project-applications export');
          }

          const projectApplications = await AdminApplicationService.getApplications(
            { projectId }, // Only filter by projectId - get all students who applied to this project
            { page: 1, limit: 10000, sortBy: 'appliedAt', sortOrder: 'desc' },
            adminAuth
          );

          const projAppHeaders = [
            'Student Name', 
            'Email', 
            'Registration No', 
            'Department', 
            'Year', 
            'Status', 
            'Applied Date',
            'Application Message',
            'Project Title'
          ];
          
          const projAppRows = await Promise.all(
            projectApplications.applications.map(async (app) => {
              try {
                const { getUserIdentity } = await import('../../clients/auth');
                const authHeader = request.headers.authorization || '';
                const studentData = await getUserIdentity(app.studentId, authHeader);
                
                return [
                  studentData.displayName || app.studentName,
                  studentData.email || 'N/A',
                  studentData.collegeMemberId || 'N/A',
                  studentData.department || app.studentDepartment,
                  studentData.year || 'N/A',
                  app.status,
                  app.appliedAt.toISOString().split('T')[0],
                  app.message || 'N/A',
                  app.project.title
                ];
              } catch (error) {
                console.error(`Error fetching student data for ${app.studentId}:`, error);
                return [
                  app.studentName,
                  'N/A',
                  'N/A', 
                  app.studentDepartment,
                  'N/A',
                  app.status,
                  app.appliedAt.toISOString().split('T')[0],
                  app.message || 'N/A',
                  app.project.title
                ];
              }
            })
          );

          csvContent = [
            projAppHeaders.join(','),
            ...projAppRows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
          ].join('\n');

          filename = `project-applications-${projectId}-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        default:
          throw new Error('Invalid export type');
      }

      await AuditLogger.logDataExport(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        `dept_${type}`,
        csvContent.split('\n').length - 1,
        { format: format || 'csv', department },
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
   * Get faculty projects in department
   */
  static async getFacultyProjects(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { facultyId } = request.params as { facultyId: string };

      const projects = await AdminProjectService.getProjects(
        { 
          department: adminAuth.scope.department,
          authorId: facultyId 
        },
        { page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'desc' },
        adminAuth
      );

      const response: AdminResponse = {
        success: true,
        data: {
          facultyId,
          department: adminAuth.scope.department,
          projects: projects.projects,
          summary: {
            totalProjects: projects.projects.length,
            activeProjects: projects.projects.filter(p => p.progressStatus !== 'COMPLETED').length,
            completedProjects: projects.projects.filter(p => p.progressStatus === 'COMPLETED').length,
            totalApplications: projects.projects.reduce((sum, p) => sum + (p.applicationCount || 0), 0)
          }
        }
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch faculty projects'
      };
      return reply.status(500).send(response);
    }
  }
}
