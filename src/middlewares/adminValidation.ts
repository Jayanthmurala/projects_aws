import { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";

// Admin validation schemas
export const adminSchemas = {
  projectModeration: z.object({
    action: z.enum(['APPROVE', 'REJECT', 'ARCHIVE']),
    reason: z.string().min(1).max(500).optional()
  }),

  bulkProjectOperation: z.object({
    projectIds: z.array(z.string().cuid()).min(1).max(100), // Limit bulk operations
    action: z.enum(['APPROVE', 'REJECT', 'ARCHIVE']),
    reason: z.string().min(1).max(500)
  }),

  applicationStatusUpdate: z.object({
    status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']),
    reason: z.string().min(1).max(500).optional()
  }),

  bulkApplicationOperation: z.object({
    applicationIds: z.array(z.string().cuid()).min(1).max(50), // Limit bulk operations
    status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']),
    reason: z.string().min(1).max(500)
  }),

  projectUpdate: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(5000).optional(),
    projectDuration: z.string().max(100).optional(),
    skills: z.array(z.string().min(1).max(50)).max(20).optional(),
    departments: z.array(z.string().regex(/^[A-Z]{2,6}$/)).max(10).optional(),
    visibleToAllDepts: z.boolean().optional(),
    projectType: z.enum(['PROJECT', 'RESEARCH', 'PAPER_PUBLISH', 'OTHER']).optional(),
    maxStudents: z.number().int().min(1).max(20).optional(),
    deadline: z.string().datetime().optional(),
    tags: z.array(z.string().min(1).max(30)).max(15).optional(),
    requirements: z.array(z.string().min(1).max(200)).max(10).optional(),
    outcomes: z.array(z.string().min(1).max(200)).max(10).optional(),
    progressStatus: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED']).optional()
  }),

  exportQuery: z.object({
    type: z.enum(['projects', 'applications']),
    format: z.enum(['csv', 'json']).optional().default('csv'),
    status: z.string().optional(),
    studentDepartment: z.string().optional(),
    projectId: z.string().cuid().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional()
  })
};

// Sanitization functions for admin inputs
export const adminSanitizers = {
  sanitizeReason: (reason: string): string => {
    return reason
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/[<>]/g, '') // Remove angle brackets
      .trim()
      .substring(0, 500); // Limit length
  },

  sanitizeSearchQuery: (query: string): string => {
    return query
      .replace(/[%_\\]/g, '\\$&') // Escape SQL wildcards
      .replace(/[<>]/g, '') // Remove angle brackets
      .trim()
      .substring(0, 100); // Limit length
  },

  sanitizeIds: (ids: string[]): string[] => {
    return ids
      .filter(id => typeof id === 'string' && id.length > 0)
      .map(id => id.trim())
      .slice(0, 100); // Limit array size
  }
};

// Admin validation middleware factory
export function createAdminValidationMiddleware(schema: z.ZodSchema) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      
      if (!body) {
        return reply.status(400).send({
          success: false,
          error: 'Request body is required'
        });
      }

      // Validate against schema
      const validation = schema.safeParse(body);
      if (!validation.success) {
        return reply.status(400).send({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }

      // Apply sanitization
      const sanitizedBody = { ...validation.data };

      if (sanitizedBody.reason && typeof sanitizedBody.reason === 'string') {
        sanitizedBody.reason = adminSanitizers.sanitizeReason(sanitizedBody.reason);
      }

      if (sanitizedBody.projectIds && Array.isArray(sanitizedBody.projectIds)) {
        sanitizedBody.projectIds = adminSanitizers.sanitizeIds(sanitizedBody.projectIds);
      }

      if (sanitizedBody.applicationIds && Array.isArray(sanitizedBody.applicationIds)) {
        sanitizedBody.applicationIds = adminSanitizers.sanitizeIds(sanitizedBody.applicationIds);
      }

      // Update request body with validated and sanitized data
      request.body = sanitizedBody;
      
    } catch (error) {
      console.error("Admin validation middleware error:", error);
      return reply.status(500).send({
        success: false,
        error: 'Validation processing failed'
      });
    }
  };
}

// Query parameter validation for admin endpoints
export function validateAdminQueryParams(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as any;
  
  // Sanitize search query if present
  if (query.search && typeof query.search === 'string') {
    query.search = adminSanitizers.sanitizeSearchQuery(query.search);
  }

  // Validate pagination parameters
  if (query.page) {
    const page = parseInt(query.page);
    if (isNaN(page) || page < 1 || page > 10000) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid page parameter'
      });
    }
    query.page = page;
  }

  if (query.limit) {
    const limit = parseInt(query.limit);
    if (isNaN(limit) || limit < 1 || limit > 1000) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid limit parameter (max 1000)'
      });
    }
    query.limit = limit;
  }

  // Validate date parameters
  if (query.startDate && typeof query.startDate === 'string') {
    const date = new Date(query.startDate);
    if (isNaN(date.getTime())) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid startDate format'
      });
    }
  }

  if (query.endDate && typeof query.endDate === 'string') {
    const date = new Date(query.endDate);
    if (isNaN(date.getTime())) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid endDate format'
      });
    }
  }

  // Update query with sanitized values
  request.query = query;
}

// Specific validation middlewares
export const validateProjectModeration = createAdminValidationMiddleware(adminSchemas.projectModeration);
export const validateBulkProjectOperation = createAdminValidationMiddleware(adminSchemas.bulkProjectOperation);
export const validateApplicationStatusUpdate = createAdminValidationMiddleware(adminSchemas.applicationStatusUpdate);
export const validateBulkApplicationOperation = createAdminValidationMiddleware(adminSchemas.bulkApplicationOperation);
export const validateProjectUpdate = createAdminValidationMiddleware(adminSchemas.projectUpdate);
export const validateExportQuery = createAdminValidationMiddleware(adminSchemas.exportQuery);
