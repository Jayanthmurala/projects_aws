import { FastifyInstance } from "fastify";
import { requireFaculty, requireFacultyOrStudent, canAccessProject, UnifiedAuthPayload } from "../middlewares/unifiedAuth";
import { prisma } from "../db";
import { emitProjectUpdate, emitApplicationUpdate } from "../utils/enhancedWebSocket";
import { CacheInvalidation } from "../utils/cacheInvalidation";
import { projectValidationMiddleware } from "../middlewares/inputValidation";
import { 
  projectSchemas, 
  applicationSchemas, 
  commonSchemas, 
  parameterSchemas 
} from "../schemas/apiSchemas";

export default async function facultyRoutes(app: FastifyInstance) {
  
  // Create project - Faculty only
  app.post("/v1/projects", {
    preHandler: [projectValidationMiddleware],
    schema: {
      tags: ["projects"],
      summary: "Create a new project",
      description: "Faculty members can create new projects for student collaboration",
      body: projectSchemas.createProjectRequest,
      response: { 
        201: {
          ...commonSchemas.successResponse,
          properties: {
            ...commonSchemas.successResponse.properties,
            data: {
              type: 'object',
              properties: {
                project: projectSchemas.project
              }
            }
          }
        },
        400: commonSchemas.errorResponse,
        401: commonSchemas.errorResponse,
        403: commonSchemas.errorResponse,
        500: commonSchemas.errorResponse
      }
    }
  }, async (req: any, reply: any) => {
    try {
      const user: UnifiedAuthPayload = await requireFaculty(req);
      const projectData = req.body;

      const project = await prisma.project.create({
        data: {
          ...projectData,
          authorId: user.sub,
          authorName: user.displayName || user.name || "Unknown Faculty",
          authorDepartment: user.scope.department,
          authorAvatar: user.scope.avatar,
          authorMemberId: user.scope.collegeMemberId,
          authorCollege: user.scope.collegeId?.toString(),
          collegeId: user.scope.collegeId?.toString() || "",
          moderationStatus: "APPROVED", // Auto-approve faculty projects
          progressStatus: "OPEN",
          skills: projectData.skills || [],
          tags: projectData.tags || [],
          departments: projectData.departments || [],
          requirements: projectData.requirements || [],
          outcomes: projectData.outcomes || []
        }
      });

      // CRITICAL: Clear cache BEFORE sending response to ensure fresh data
      console.log('🚨 PROJECT CREATED - Starting cache invalidation for project:', project.id);
      await CacheInvalidation.invalidateByEntity('project', project.id, 'create', {
        collegeId: project.collegeId.toString(),
        authorId: user.sub
      });
      console.log('✅ PROJECT CREATED - Cache invalidation completed for project:', project.id);

      // Emit WebSocket event for new project
      console.log('🚀 PROJECT CREATED - Emitting WebSocket event for project:', project.id);
      emitProjectUpdate({
        type: 'new-project',
        projectId: project.id,
        project: project,
        collegeId: project.collegeId.toString(),
        departments: project.authorDepartment ? [project.authorDepartment] : [],
        visibleToAllDepts: project.visibleToAllDepts,
        createdBy: { id: user.sub, name: user.displayName || "Unknown Faculty" },
        timestamp: new Date().toISOString()
      });
      console.log('📡 PROJECT CREATED - WebSocket event emitted for project:', project.id);

      return reply.status(201).send({
        success: true,
        data: { project }
      });
    } catch (error: any) {
      console.error("Error creating project:", error);
      console.error("Error details:", {
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
        meta: error?.meta
      });
      console.error("Project data received:", req.body);
      
      let userInfo = "No user info available";
      try {
        const debugUser = await requireFaculty(req);
        userInfo = JSON.stringify({
          sub: debugUser?.sub,
          displayName: debugUser?.displayName,
          name: debugUser?.name,
          scope: debugUser?.scope
        });
      } catch (userError) {
        userInfo = `User auth error: ${userError}`;
      }
      console.error("User data:", userInfo);
      
      return reply.status(500).send({
        success: false,
        error: "Failed to create project",
        details: error?.message || "Unknown error"
      });
    }
  });

  // Update project - Faculty (owner) only
  app.put("/v1/projects/:id", {
    schema: {
      tags: ["projects"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', minLength: 1, maxLength: 2000 },
          requirements: { 
            type: 'array', 
            items: { type: 'string' } 
          },
          outcomes: { 
            type: 'array', 
            items: { type: 'string' } 
          },
          maxStudents: { type: 'integer', minimum: 1, maximum: 20 },
          deadline: { type: 'string', format: 'date-time' },
          departments: { 
            type: 'array', 
            items: { type: 'string' } 
          },
          visibleToAllDepts: { type: 'boolean' },
          skills: { 
            type: 'array', 
            items: { type: 'string' } 
          },
          tags: { 
            type: 'array', 
            items: { type: 'string' } 
          },
          progressStatus: { 
            type: 'string', 
            enum: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] 
          }
        }
      },
      response: { 200: { type: 'object' } }
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFaculty(req);
      const { id } = req.params;
      const updateData = req.body;

      // Verify project ownership
      const existingProject = await prisma.project.findUnique({
        where: { id }
      });

      if (!existingProject) {
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      if (existingProject.authorId !== user.sub) {
        return reply.status(403).send({
          success: false,
          error: "Only project author can update the project"
        });
      }

      const updatedProject = await prisma.project.update({
        where: { id },
        data: updateData
      });

      // CRITICAL: Clear cache BEFORE sending response
      await CacheInvalidation.invalidateByEntity('project', updatedProject.id, 'update', {
        collegeId: updatedProject.collegeId.toString(),
        authorId: user.sub
      });

      // Emit WebSocket event for project update
      emitProjectUpdate({
        type: 'project-updated',
        projectId: updatedProject.id,
        project: updatedProject,
        collegeId: updatedProject.collegeId.toString(),
        departments: updatedProject.authorDepartment ? [updatedProject.authorDepartment] : [],
        visibleToAllDepts: updatedProject.visibleToAllDepts,
        updatedBy: { id: user.sub, name: user.displayName || "Unknown Faculty" },
        timestamp: new Date().toISOString()
      });

      return reply.send({
        success: true,
        data: { project: updatedProject }
      });
    } catch (error) {
      console.error("Error updating project:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to update project"
      });
    }
  });

  // Delete project - Faculty (owner) only
  app.delete("/v1/projects/:id", {
    schema: {
      tags: ["projects"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      response: { 200: { type: 'object' } }
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFaculty(req);
      const { id } = req.params;

      // Verify project ownership
      const existingProject = await prisma.project.findUnique({
        where: { id }
      });

      if (!existingProject) {
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      if (existingProject.authorId !== user.sub) {
        return reply.status(403).send({
          success: false,
          error: "Only project author can delete the project"
        });
      }

      // Soft delete by setting archivedAt
      const archivedProject = await prisma.project.update({
        where: { id },
        data: { archivedAt: new Date() }
      });

      // CRITICAL: Clear cache BEFORE sending response
      console.log('🗑️ PROJECT ARCHIVED - Starting cache invalidation for project:', id);
      await CacheInvalidation.invalidateByEntity('project', id, 'delete', {
        collegeId: existingProject.collegeId.toString(),
        authorId: user.sub
      });
      console.log('✅ PROJECT ARCHIVED - Cache invalidation completed for project:', id);

      // Emit WebSocket event for project deletion/archive
      console.log('🚀 PROJECT ARCHIVED - Emitting WebSocket event for project:', id);
      emitProjectUpdate({
        type: 'project-deleted',
        projectId: id,
        project: {
          id: archivedProject.id,
          title: existingProject.title,
          description: existingProject.description
        },
        collegeId: existingProject.collegeId.toString(),
        departments: existingProject.authorDepartment ? [existingProject.authorDepartment] : [],
        visibleToAllDepts: existingProject.visibleToAllDepts,
        deletedBy: { id: user.sub, name: user.displayName || "Faculty" },
        timestamp: new Date().toISOString()
      });
      console.log('📡 PROJECT ARCHIVED - WebSocket event emitted for project:', id);

      return reply.send({
        success: true,
        message: "Project deleted successfully"
      });
    } catch (error) {
      console.error("Error deleting project:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to delete project"
      });
    }
  });

  // Get project applications - Faculty (owner) only
  app.get("/v1/projects/:id/applications", {
    schema: {
      tags: ["applications"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      response: { 200: { type: 'object' } }
    }
  }, async (req: any, reply: any) => {
    console.log('\n=== [DEBUG] /v1/projects/:id/applications endpoint called ===');
    console.log('[DEBUG] Project ID:', req.params.id);
    
    try {
      console.log('[DEBUG] Calling requireFaculty...');
      const user = await requireFaculty(req);
      console.log('[DEBUG] requireFaculty SUCCESS - user:', {
        sub: user.sub,
        collegeId: user.scope?.collegeId,
        department: user.scope?.department
      });
      
      const { id } = req.params;

      // Verify project ownership
      console.log('[DEBUG] Checking project ownership for project:', id);
      const project = await prisma.project.findUnique({
        where: { id }
      });
      console.log('[DEBUG] Project found:', project ? {
        id: project.id,
        title: project.title,
        authorId: project.authorId
      } : null);

      if (!project) {
        console.log('[DEBUG] Project not found');
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      if (project.authorId !== user.sub) {
        console.log('[DEBUG] User not authorized - project author:', project.authorId, 'user:', user.sub);
        return reply.status(403).send({
          success: false,
          error: "Only project author can view applications"
        });
      }

      console.log('[DEBUG] Fetching applications for project:', id);
      const applications = await prisma.appliedProject.findMany({
        where: { projectId: id },
        orderBy: { appliedAt: 'desc' }
      });
      console.log('[DEBUG] Applications found:', applications.length);
      console.log('[DEBUG] Sample application:', applications[0] ? {
        id: applications[0].id,
        studentId: applications[0].studentId,
        studentName: applications[0].studentName,
        studentDepartment: applications[0].studentDepartment,
        status: applications[0].status,
        appliedAt: applications[0].appliedAt
      } : null);

      const response = {
        success: true,
        data: { applications }
      };
      
      console.log('[DEBUG] Sending response:', JSON.stringify(response, null, 2));
      console.log('[DEBUG] Response headers before send:', reply.getHeaders());
      
      // Try different response methods to debug serialization
      const responseString = JSON.stringify(response);
      console.log('[DEBUG] Response as string:', responseString);
      console.log('[DEBUG] Response string length:', responseString.length);
      
      return reply
        .code(200)
        .header('Content-Type', 'application/json; charset=utf-8')
        .serializer((payload: any) => {
          console.log('[DEBUG] Custom serializer called with:', payload);
          return JSON.stringify(payload);
        })
        .send(response);
    } catch (error: any) {
      console.error('\n=== [ERROR] /v1/projects/:id/applications endpoint FAILED ===');
      console.error('[ERROR] Error object:', error);
      console.error('[ERROR] Error name:', error?.name);
      console.error('[ERROR] Error message:', error?.message);
      console.error('[ERROR] Stack trace:', error?.stack);
      console.error('=== END ERROR ===\n');
      
      return reply.status(500).send({
        success: false,
        error: "Failed to fetch applications"
      });
    }
  });

  // Update application status - Faculty (project owner) only
  app.put("/v1/applications/:id/status", {
    schema: {
      tags: ["applications"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      body: {
        type: 'object',
        properties: {
          status: { 
            type: 'string', 
            enum: ['PENDING', 'ACCEPTED', 'REJECTED'] 
          },
          reason: { type: 'string' }
        },
        required: ['status']
      },
      response: { 200: { type: 'object' } }
    }
  }, async (req: any, reply: any) => {
    try {
      const facultyAuth = await requireFaculty(req);
      const { id } = req.params;
      const { status, reason } = req.body;

      // Get application with project info
      const application = await prisma.appliedProject.findUnique({
        where: { id },
        include: {
          project: {
            select: { authorId: true, title: true }
          }
        }
      });

      if (!application) {
        return reply.status(404).send({
          success: false,
          error: "Application not found"
        });
      }

      // Verify project ownership
      if (application.project.authorId !== facultyAuth.sub) {
        return reply.status(403).send({
          success: false,
          error: "Only project author can update application status"
        });
      }

      const updatedApplication = await prisma.appliedProject.update({
        where: { id },
        data: { 
          status
        }
      });

      // CRITICAL: Clear cache BEFORE sending response
      await CacheInvalidation.invalidateByEntity('application', id, 'update', {
        projectId: updatedApplication.projectId,
        studentId: updatedApplication.studentId,
        collegeId: facultyAuth.scope.collegeId?.toString() || ''
      });

      // Emit WebSocket event for application status update
      emitApplicationUpdate(facultyAuth.sub, {
        type: 'application-status-changed',
        application: updatedApplication,
        projectId: updatedApplication.projectId,
        collegeId: facultyAuth.scope.collegeId?.toString() || '',
        timestamp: new Date().toISOString()
      });

      return reply.send({
        success: true,
        data: { application: updatedApplication }
      });
    } catch (error) {
      console.error("Error updating application status:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to update application status"
      });
    }
  });
}
