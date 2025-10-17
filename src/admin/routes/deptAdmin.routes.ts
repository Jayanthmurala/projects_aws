import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireDeptAdmin } from '../middleware/adminAuth';
import { DeptAdminController } from '../controllers/DeptAdminController';
import {
  projectFiltersSchema,
  paginationSchema,
  facultyParamsSchema,
  projectModerationSchema,
  exportQuerySchema,
  projectsListResponseSchema,
  applicationsListResponseSchema,
  analyticsResponseSchema,
  dashboardResponseSchema,
  errorResponseSchema
} from '../validators/adminProjectSchemas';

export async function deptAdminRoutes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>();

  // Apply admin authentication to all routes
  f.addHook('preHandler', async (request, reply) => {
    const adminAuth = await requireDeptAdmin(request);
    (request as any).adminAuth = adminAuth;
  });

  // Dashboard
  f.get('/v1/admin/dept/dashboard', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get DEPT_ADMIN dashboard data',
      description: 'Retrieve department-specific project analytics and recent projects'
    }
  }, DeptAdminController.getDashboard);

  // Enums/Options
  f.get('/v1/admin/dept/enums', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get enum values',
      description: 'Retrieve all enum values for dropdowns and filters'
    }
  }, DeptAdminController.getEnums);

  // Project Management (Department Scoped)
  f.get('/v1/admin/dept/projects', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get department projects',
      description: 'Retrieve all projects from admin\'s department with filtering options'
    }
  }, DeptAdminController.getProjects);

  f.get('/v1/admin/dept/projects/:projectId', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get single project',
      description: 'Retrieve detailed project information'
    }
  }, DeptAdminController.getProject);

  f.put('/v1/admin/dept/projects/:projectId', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Update project',
      description: 'Update a project from admin\'s department (author must be from same department)'
    }
  }, DeptAdminController.updateProject);

  f.patch('/v1/admin/dept/projects/:projectId/moderate', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Moderate project',
      description: 'Approve or reject a project from admin\'s department',
    }
  }, DeptAdminController.moderateProject);

  // Application Management (Department Scoped) - Rebuilt with proper validation and controls
  
  // Get all applications for department projects
  f.get('/v1/admin/dept/applications', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get department applications',
      description: 'Retrieve all applications for projects in admin\'s department with filtering and pagination',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', pattern: '^[1-9]\\d*$' },
          limit: { type: 'string', pattern: '^[1-9]\\d*$' },
          status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REJECTED'] },
          projectId: { type: 'string' },
          studentId: { type: 'string' },
          studentDepartment: { type: 'string' },
          search: { type: 'string', minLength: 1, maxLength: 100 },
          sortBy: { type: 'string', enum: ['appliedAt', 'status', 'studentName', 'projectTitle'] },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
          appliedAfter: { type: 'string', format: 'date' },
          appliedBefore: { type: 'string', format: 'date' }
        },
        additionalProperties: false
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  projectId: { type: 'string' },
                  studentId: { type: 'string' },
                  studentName: { type: 'string' },
                  studentDepartment: { type: 'string' },
                  status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REJECTED'] },
                  message: { type: 'string', nullable: true },
                  appliedAt: { type: 'string', format: 'date-time' },
                  project: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      title: { type: 'string' },
                      authorName: { type: 'string' },
                      authorDepartment: { type: 'string' },
                      maxStudents: { type: 'number' }
                    }
                  }
                }
              }
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'number' },
                limit: { type: 'number' },
                total: { type: 'number' },
                totalPages: { type: 'number' }
              }
            }
          }
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, DeptAdminController.getApplications);

  // Get single application by ID
  f.get('/v1/admin/dept/applications/:applicationId', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get single application',
      description: 'Retrieve detailed information about a specific application',
      params: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' }
        },
        required: ['applicationId'],
        additionalProperties: false
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                projectId: { type: 'string' },
                studentId: { type: 'string' },
                studentName: { type: 'string' },
                studentDepartment: { type: 'string' },
                status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REJECTED'] },
                message: { type: 'string', nullable: true },
                appliedAt: { type: 'string', format: 'date-time' },
                project: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    authorName: { type: 'string' },
                    authorDepartment: { type: 'string' },
                    maxStudents: { type: 'number' },
                    skills: { type: 'array', items: { type: 'string' } },
                    departments: { type: 'array', items: { type: 'string' } },
                    progressStatus: { type: 'string' },
                    deadline: { type: 'string', format: 'date-time', nullable: true }
                  }
                }
              }
            }
          }
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, DeptAdminController.getApplication);

  // Update application status (Accept/Reject)
  f.patch('/v1/admin/dept/applications/:applicationId/status', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Update application status',
      description: 'Accept or reject a student application for a department project',
      params: {
        type: 'object',
        properties: {
          applicationId: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' }
        },
        required: ['applicationId'],
        additionalProperties: false
      },
      body: {
        type: 'object',
        properties: {
          status: { 
            type: 'string',
            enum: ['ACCEPTED', 'REJECTED'],
            description: 'New status for the application'
          },
          reason: { 
            type: 'string', 
            minLength: 1,
            maxLength: 500,
            description: 'Reason for the status change'
          },
          feedback: {
            type: 'string',
            maxLength: 1000,
            description: 'Optional feedback for the student'
          }
        },
        required: ['status', 'reason'],
        additionalProperties: false
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                status: { type: 'string' },
                updatedAt: { type: 'string', format: 'date-time' }
              }
            },
            message: { type: 'string' }
          }
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, DeptAdminController.updateApplicationStatus);

  // Bulk update application statuses
  f.patch('/v1/admin/dept/applications/bulk', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Bulk update application statuses',
      description: 'Accept or reject multiple applications at once',
      body: {
        type: 'object',
        properties: {
          applicationIds: {
            type: 'array',
            items: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' },
            minItems: 1,
            maxItems: 50,
            uniqueItems: true
          },
          status: {
            type: 'string',
            enum: ['ACCEPTED', 'REJECTED']
          },
          reason: {
            type: 'string',
            minLength: 1,
            maxLength: 500
          },
          feedback: {
            type: 'string',
            maxLength: 1000
          }
        },
        required: ['applicationIds', 'status', 'reason'],
        additionalProperties: false
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                totalProcessed: { type: 'number' },
                successful: { type: 'number' },
                failed: { type: 'number' },
                errors: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      applicationId: { type: 'string' },
                      error: { type: 'string' }
                    }
                  }
                }
              }
            },
            message: { type: 'string' }
          }
        }
      }
    }
  }, DeptAdminController.bulkUpdateApplicationStatus);

  // Get application statistics
  f.get('/v1/admin/dept/applications/stats', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get application statistics',
      description: 'Get statistics about applications for department projects',
      querystring: {
        type: 'object',
        properties: {
          timeRange: { type: 'string', enum: ['7d', '30d', '90d', '1y'] },
          projectId: { type: 'string' }
        },
        additionalProperties: false
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                totalApplications: { type: 'number' },
                applicationsByStatus: {
                  type: 'object',
                  properties: {
                    pending: { type: 'number' },
                    accepted: { type: 'number' },
                    rejected: { type: 'number' }
                  }
                },
                applicationsByDepartment: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      department: { type: 'string' },
                      count: { type: 'number' }
                    }
                  }
                },
                topAppliedProjects: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      projectId: { type: 'string' },
                      projectTitle: { type: 'string' },
                      applicationCount: { type: 'number' }
                    }
                  }
                },
                acceptanceRate: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, DeptAdminController.getApplicationStats);

  // Analytics (Department Scoped)
  f.get('/v1/admin/dept/analytics', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get department analytics',
      description: 'Retrieve analytics data for admin\'s department projects'
    }
  }, DeptAdminController.getAnalytics);

  // Faculty Management
  f.get('/v1/admin/dept/faculty/:facultyId/projects', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Get faculty projects',
      description: 'Retrieve projects by specific faculty in admin\'s department',
    }
  }, DeptAdminController.getFacultyProjects);

  // Data Export (Department Scoped)
  f.get('/v1/admin/dept/export', {
    schema: {
      tags: ['dept-admin'],
      summary: 'Export department data',
      description: 'Export department project and application data in CSV format'
    }
  }, DeptAdminController.exportData);
}

export default deptAdminRoutes;
