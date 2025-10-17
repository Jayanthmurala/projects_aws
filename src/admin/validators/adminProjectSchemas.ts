import { z } from 'zod';

// Project filtering schemas
export const projectFiltersSchema = z.object({
  search: z.string().optional(),
  moderationStatus: z.string().optional(),
  projectType: z.string().optional(),
  skills: z.string().optional(),
  tags: z.string().optional(),
  department: z.string().optional(),
  authorDepartment: z.string().optional(),
  createdAfter: z.string().optional(),
  createdBefore: z.string().optional(),
  isActive: z.string().optional(),
  hasApplications: z.string().optional()
});

// Pagination schema
export const paginationSchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional()
});

// Route parameter schemas
export const projectParamsSchema = z.object({
  projectId: z.string()
});

export const applicationParamsSchema = z.object({
  applicationId: z.string()
});

export const facultyParamsSchema = z.object({
  facultyId: z.string()
});

// Project moderation schemas
export const projectModerationSchema = z.object({
  status: z.string(),
  reason: z.string(),
  feedback: z.string().optional()
});


// Application status update schema
export const applicationStatusSchema = z.object({
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']),
  reason: z.string().optional(),
  feedback: z.string().optional()
});

// Bulk operations schema
export const bulkProjectOperationSchema = z.object({
  action: z.string(),
  projectIds: z.array(z.string()),
  reason: z.string(),
  preview: z.boolean().optional()
});

export const bulkApplicationOperationSchema = z.object({
  action: z.string(),
  applicationIds: z.array(z.string()),
  reason: z.string(),
  preview: z.boolean().optional()
});

// Export query schema
export const exportQuerySchema = z.object({
  type: z.string().optional(),
  filters: z.string().optional()
});

// Response schemas
export const projectResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  authorId: z.string(),
  authorName: z.string().optional(),
  authorDepartment: z.string().optional(),
  collegeId: z.string(),
  moderationStatus: z.string(),
  projectType: z.string().optional(),
  skills: z.array(z.string()),
  tags: z.array(z.string()),
  maxApplicants: z.number().optional(),
  applicationCount: z.number().optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const applicationResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  studentId: z.string(),
  studentName: z.string().optional(),
  studentDepartment: z.string().optional(),
  status: z.string(),
  appliedAt: z.string(),
  message: z.string().optional(),
  feedback: z.string().optional()
});

// List response schemas
export const projectsListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(projectResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number()
  }).optional(),
  message: z.string().optional()
});

export const applicationsListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(applicationResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number()
  }).optional(),
  message: z.string().optional()
});

// Analytics response schema
export const analyticsResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    totalProjects: z.number(),
    projectsByStatus: z.record(z.string(), z.number()),
    projectsByDepartment: z.record(z.string(), z.number()),
    totalApplications: z.number(),
    applicationsByStatus: z.record(z.string(), z.number()),
    averageApplicationsPerProject: z.number(),
    topSkills: z.array(z.object({
      skill: z.string(),
      count: z.number()
    })),
    monthlyTrends: z.array(z.object({
      month: z.string(),
      projects: z.number(),
      applications: z.number()
    }))
  }),
  message: z.string().optional()
});

// Dashboard response schema
export const dashboardResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    department: z.string(),
    projectAnalytics: z.object({
      totalProjects: z.number(),
      projectsByStatus: z.record(z.string(), z.number())
    }),
    applicationAnalytics: z.object({
      totalApplications: z.number(),
      applicationsByStatus: z.record(z.string(), z.number())
    }),
    recentProjects: z.array(z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      authorName: z.string().optional(),
      moderationStatus: z.string(),
      skills: z.array(z.string()),
      applicationCount: z.number().optional(),
      createdAt: z.string()
    })),
    summary: z.object({
      totalProjects: z.number(),
      pendingApproval: z.number(),
      totalApplications: z.number(),
      departmentFocus: z.boolean()
    })
  }),
  message: z.string().optional()
});

// Bulk operation response schema
export const bulkOperationResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    totalProcessed: z.number(),
    successful: z.number(),
    failed: z.number(),
    errors: z.array(z.object({
      index: z.number(),
      error: z.string(),
      data: z.any().optional()
    })),
    preview: z.boolean().optional()
  }),
  message: z.string().optional()
});

// Error response schema
export const errorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  errors: z.array(z.string()).optional()
});
