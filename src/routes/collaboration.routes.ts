import { FastifyInstance } from "fastify";
import { requireFacultyOrStudent, requireFaculty, canAccessProject } from "../middlewares/unifiedAuth";
import { fileUploadValidationMiddleware } from "../middlewares/fileValidation";
import { rateLimitFileUpload } from "../middlewares/rateLimitMiddleware";
import { prisma } from "../db";
import { emitProjectUpdate } from "../utils/enhancedWebSocket";
import { CacheInvalidation } from "../utils/cacheInvalidation";
import { getUserIdentity } from "../clients/auth";

export default async function collaborationRoutes(app: FastifyInstance) {
  
  // Get project members - Project members only
  app.get("/v1/projects/:id/members", {
    schema: {
      tags: ["collaboration"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      }
      // Remove restrictive response schema
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { id: projectId } = req.params;

      // Verify project membership
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          applications: {
            where: { 
              status: 'ACCEPTED'
            },
            select: {
              studentId: true,
              studentName: true,
              studentDepartment: true
            }
          }
        }
      });

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      // Check if user is project author or accepted member
      const isAuthor = project.authorId === user.sub;
      const isAcceptedMember = project.applications.some(app => 
        app.studentId === user.sub
      ); // No need to check status since query already filters by ACCEPTED

      if (!isAuthor && !isAcceptedMember) {
        return reply.status(403).send({
          success: false,
          error: "Access denied. You must be a project member."
        });
      }

      // Build members list with fallback for "Unknown Student"
      const members = [
        // Project author (faculty)
        {
          id: project.authorId,
          name: project.authorName,
          role: 'faculty',
          department: project.authorDepartment
        }
      ];

      // Process accepted students and fetch real names if needed
      for (const app of project.applications) {
        let studentName = app.studentName;
        
        // If student name is "Unknown Student", try to fetch from auth service
        if (studentName === "Unknown Student") {
          try {
            console.log(`[DEBUG] Fetching real name for student ${app.studentId}`);
            const authHeader = req.headers.authorization || '';
            const userIdentity = await getUserIdentity(app.studentId, authHeader);
            studentName = userIdentity.displayName || "Unknown Student";
            console.log(`[DEBUG] Resolved name: ${studentName}`);
          } catch (error) {
            console.warn(`Failed to fetch identity for student ${app.studentId}:`, error);
            // Keep "Unknown Student" as fallback
          }
        }

        members.push({
          id: app.studentId,
          name: studentName,
          role: 'student',
          department: app.studentDepartment
        });
      }

      console.log('[GET /v1/projects/:id/members] Members data:', {
        projectId,
        membersCount: members.length,
        members: members.map(m => ({ id: m.id, name: m.name, role: m.role }))
      });

      return reply.send({
        success: true,
        data: { members }
      });
    } catch (error) {
      console.error("Error fetching project members:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to fetch project members"
      });
    }
  });

  // Get project tasks - Project members only
  app.get("/v1/projects/:id/tasks", {
    schema: {
      tags: ["tasks"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      }
      // Remove restrictive response schema
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { id: projectId } = req.params;

      // Verify project membership
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          applications: {
            where: { 
              status: 'ACCEPTED',
              studentId: user.sub 
            }
          }
        }
      });

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      // Check if user is project author or accepted member
      const isAuthor = project.authorId === user.sub;
      const isAcceptedMember = project.applications.some(app => 
        app.studentId === user.sub && app.status === 'ACCEPTED'
      );

      if (!isAuthor && !isAcceptedMember) {
        return reply.status(403).send({
          success: false,
          error: "Access denied. You must be a project member."
        });
      }

      const tasks = await prisma.projectTask.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' }
      });

      return reply.send({
        success: true,
        data: { tasks }
      });
    } catch (error) {
      console.error("Error fetching tasks:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to fetch tasks"
      });
    }
  });

  // Create task - Faculty only
  app.post("/v1/projects/:id/tasks", {
    schema: {
      tags: ["tasks"],
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
          assignedToId: { type: 'string' }
        },
        required: ['title']
      }
      // Remove restrictive response schema
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFaculty(req); // Only faculty can create tasks
      const { id: projectId } = req.params;
      const taskData = req.body;

      // Verify project membership - Faculty must be the project author
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          authorId: true
        }
      });

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      const isAuthor = project.authorId === user.sub;

      if (!isAuthor) {
        return reply.status(403).send({
          success: false,
          error: "Access denied. Only project authors can create tasks."
        });
      }

      const task = await prisma.projectTask.create({
        data: {
          title: taskData.title,
          projectId,
          assignedToId: taskData.assignedToId || null,
          status: 'TODO'
        }
      });

      // Get project info for WebSocket event
      const projectInfo = await prisma.project.findUnique({
        where: { id: projectId },
        select: { collegeId: true, departments: true, visibleToAllDepts: true }
      });

      // Emit WebSocket event for new task
      emitProjectUpdate({
        type: 'task-created',
        projectId,
        collegeId: projectInfo?.collegeId || '',
        departments: projectInfo?.departments || [],
        visibleToAllDepts: projectInfo?.visibleToAllDepts || false,
        task: {
          id: task.id,
          title: task.title,
          assignedToId: task.assignedToId,
          status: task.status,
          createdAt: task.createdAt
        },
        createdBy: {
          id: user.sub,
          name: user.displayName || "Unknown User"
        },
        timestamp: new Date().toISOString()
      });

      return reply.status(201).send({
        success: true,
        data: { task }
      });
    } catch (error) {
      console.error("Error creating task:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to create task"
      });
    }
  });

  // Update task - Project members only
  app.put("/v1/tasks/:id", {
    schema: {
      tags: ["tasks"],
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
          assignedToId: { type: 'string' },
          status: { 
            type: 'string', 
            enum: ['TODO', 'IN_PROGRESS', 'DONE'] 
          }
        }
      }
      // Remove restrictive response schema
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { id: taskId } = req.params;
      const updateData = req.body;

      // Get task with project info
      const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
        include: {
          project: {
            include: {
              applications: {
                where: { 
                  status: 'ACCEPTED',
                  studentId: user.sub 
                }
              }
            }
          }
        }
      });

      if (!task) {
        return reply.status(404).send({
          success: false,
          error: "Task not found"
        });
      }

      // Verify project membership
      const isAuthor = task.project.authorId === user.sub;
      const isAcceptedMember = task.project.applications.some(app => 
        app.studentId === user.sub && app.status === 'ACCEPTED'
      );

      if (!isAuthor && !isAcceptedMember) {
        return reply.status(403).send({
          success: false,
          error: "Access denied. You must be a project member."
        });
      }

      const updatedTask = await prisma.projectTask.update({
        where: { id: taskId },
        data: {
          title: updateData.title,
          assignedToId: updateData.assignedToId || null,
          status: updateData.status
        }
      });

      // Emit WebSocket event for task update
      emitProjectUpdate({
        type: 'task-updated',
        projectId: task.projectId,
        collegeId: task.project.collegeId,
        departments: task.project.departments,
        visibleToAllDepts: task.project.visibleToAllDepts,
        task: {
          id: updatedTask.id,
          title: updatedTask.title,
          assignedToId: updatedTask.assignedToId,
          status: updatedTask.status,
          createdAt: updatedTask.createdAt
        },
        updatedBy: {
          id: user.sub,
          name: user.displayName || user.scope.displayName || user.name || "Unknown User"
        },
        timestamp: new Date().toISOString()
      });

      return reply.send({
        success: true,
        data: { task: updatedTask }
      });
    } catch (error) {
      console.error("Error updating task:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to update task"
      });
    }
  });

  // Delete task - Project members only
  app.delete("/v1/tasks/:id", {
    schema: {
      tags: ["tasks"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      }
      // Remove restrictive response schema
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { id: taskId } = req.params;

      // Get task with project info
      const task = await prisma.projectTask.findUnique({
        where: { id: taskId },
        include: {
          project: {
            include: {
              applications: {
                where: { 
                  status: 'ACCEPTED',
                  studentId: user.sub 
                }
              }
            }
          }
        }
      });

      if (!task) {
        return reply.status(404).send({
          success: false,
          error: "Task not found"
        });
      }

      // Verify project membership
      const isAuthor = task.project.authorId === user.sub;
      const isAcceptedMember = task.project.applications.some(app => 
        app.studentId === user.sub && app.status === 'ACCEPTED'
      );

      if (!isAuthor && !isAcceptedMember) {
        return reply.status(403).send({
          success: false,
          error: "Access denied. You must be a project member."
        });
      }

      await prisma.projectTask.delete({
        where: { id: taskId }
      });

      return reply.send({
        success: true,
        message: "Task deleted successfully"
      });
    } catch (error) {
      console.error("Error deleting task:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to delete task"
      });
    }
  });

  // Get project attachments - Project members only
  app.get("/v1/projects/:id/attachments", {
    schema: {
      tags: ["attachments"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      }
      // Remove restrictive response schema
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { id: projectId } = req.params;

      // Verify project membership
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          applications: {
            where: { 
              status: 'ACCEPTED',
              studentId: user.sub 
            }
          }
        }
      });

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      const isAuthor = project.authorId === user.sub;
      const isAcceptedMember = project.applications.length > 0;

      if (!isAuthor && !isAcceptedMember) {
        return reply.status(403).send({
          success: false,
          error: "Access denied. You must be a project member."
        });
      }

      const attachments = await prisma.projectAttachment.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' }
      });

      return reply.send({
        success: true,
        data: { attachments }
      });
    } catch (error) {
      console.error("Error fetching attachments:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to fetch attachments"
      });
    }
  });

  // Upload attachment - Project members only
  app.post("/v1/projects/:id/attachments", {
    preHandler: [fileUploadValidationMiddleware],
    schema: {
      tags: ["attachments"],
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
          fileName: { type: 'string', minLength: 1, maxLength: 255 },
          fileUrl: { type: 'string', format: 'uri' },
          fileType: { type: 'string' },
          fileSize: { type: 'integer', minimum: 1, maximum: 52428800 }, // 50MB max
          description: { type: 'string', maxLength: 500 }
        },
        required: ['fileName', 'fileUrl', 'fileType']
      },
      // Allow full payload to avoid serializer stripping
      response: { 201: { type: 'object', additionalProperties: true } }
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { id: projectId } = req.params;
      const attachmentData = req.body;

      // Verify project membership
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          applications: {
            where: { 
              status: 'ACCEPTED',
              studentId: user.sub 
            }
          }
        }
      });

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      const isAuthor = project.authorId === user.sub;
      const isAcceptedMember = project.applications.length > 0;

      if (!isAuthor && !isAcceptedMember) {
        return reply.status(403).send({
          success: false,
          error: "Access denied. You must be a project member."
        });
      }

      console.log('[POST /v1/projects/:id/attachments] Creating attachment:', {
        projectId,
        fileName: attachmentData.fileName,
        fileUrl: attachmentData.fileUrl,
        fileType: attachmentData.fileType,
        uploaderId: user.sub
      });

      const attachment = await prisma.projectAttachment.create({
        data: {
          fileName: attachmentData.fileName,
          fileUrl: attachmentData.fileUrl,
          fileType: attachmentData.fileType,
          projectId,
          uploaderId: user.sub
        }
      });

      console.log('[POST /v1/projects/:id/attachments] Attachment created:', attachment.id);

      // Emit WebSocket event for new attachment
      emitProjectUpdate({
        type: 'file-uploaded',
        projectId,
        collegeId: project.collegeId,
        departments: project.departments,
        visibleToAllDepts: project.visibleToAllDepts,
        attachment: {
          id: attachment.id,
          fileName: attachment.fileName,
          fileType: attachment.fileType,
          uploadedBy: user.displayName || user.scope.displayName || user.name || "Unknown User"
        },
        createdBy: {
          id: user.sub,
          name: user.displayName || "Unknown User"
        },
        timestamp: new Date().toISOString()
      });

      return reply.status(201).send({
        success: true,
        data: { attachment }
      });
    } catch (error) {
      console.error("Error uploading attachment:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to upload attachment"
      });
    }
  });

  // Update attachment - Project members only (uploader or project author)
  app.put("/v1/attachments/:id", {
    schema: {
      tags: ["attachments"],
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
          fileName: { type: 'string', minLength: 1, maxLength: 255 }
        },
        required: ['fileName']
      },
      response: { 200: { type: 'object', additionalProperties: true } }
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { id: attachmentId } = req.params;
      const { fileName } = req.body;

      // Get attachment with project info
      const attachment = await prisma.projectAttachment.findUnique({
        where: { id: attachmentId },
        include: {
          project: {
            select: { 
              authorId: true,
              collegeId: true,
              departments: true,
              visibleToAllDepts: true
            }
          }
        }
      });

      if (!attachment) {
        return reply.status(404).send({
          success: false,
          error: "Attachment not found"
        });
      }

      // Only uploader or project author can update
      const isUploader = attachment.uploaderId === user.sub;
      const isProjectAuthor = attachment.project.authorId === user.sub;

      if (!isUploader && !isProjectAuthor) {
        return reply.status(403).send({
          success: false,
          error: "Only the uploader or project author can update this attachment"
        });
      }

      const updatedAttachment = await prisma.projectAttachment.update({
        where: { id: attachmentId },
        data: { fileName }
      });

      console.log('[PUT /v1/attachments/:id] Attachment updated:', updatedAttachment.id);

      // Emit WebSocket event for attachment update
      emitProjectUpdate({
        type: 'file-updated',
        projectId: attachment.projectId,
        collegeId: attachment.project.collegeId,
        departments: attachment.project.departments,
        visibleToAllDepts: attachment.project.visibleToAllDepts,
        attachment: {
          id: updatedAttachment.id,
          fileName: updatedAttachment.fileName,
          fileType: updatedAttachment.fileType
        },
        updatedBy: {
          id: user.sub,
          name: user.displayName || user.scope?.displayName || user.name || "Unknown User"
        },
        timestamp: new Date().toISOString()
      });

      return reply.send({
        success: true,
        data: { attachment: updatedAttachment }
      });
    } catch (error) {
      console.error("Error updating attachment:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to update attachment"
      });
    }
  });

  // Delete attachment - Project members only (uploader or project author)
  app.delete("/v1/attachments/:id", {
    schema: {
      tags: ["attachments"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      }
      // Remove restrictive response schema
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { id: attachmentId } = req.params;

      // Get attachment with project info
      const attachment = await prisma.projectAttachment.findUnique({
        where: { id: attachmentId },
        include: {
          project: {
            select: { 
              authorId: true,
              collegeId: true,
              departments: true,
              visibleToAllDepts: true
            }
          }
        }
      });

      if (!attachment) {
        return reply.status(404).send({
          success: false,
          error: "Attachment not found"
        });
      }

      // Only uploader or project author can delete
      const isUploader = attachment.uploaderId === user.sub;
      const isProjectAuthor = attachment.project.authorId === user.sub;

      if (!isUploader && !isProjectAuthor) {
        return reply.status(403).send({
          success: false,
          error: "Only the uploader or project author can delete this attachment"
        });
      }

      // Store attachment info before deletion for WebSocket event
      const attachmentInfo = {
        id: attachment.id,
        fileName: attachment.fileName,
        projectId: attachment.projectId
      };

      await prisma.projectAttachment.delete({
        where: { id: attachmentId }
      });

      console.log('[DELETE /v1/attachments/:id] Attachment deleted:', attachmentId);

      // Emit WebSocket event for attachment deletion
      emitProjectUpdate({
        type: 'file-deleted',
        projectId: attachmentInfo.projectId,
        collegeId: attachment.project.collegeId,
        departments: attachment.project.departments,
        visibleToAllDepts: attachment.project.visibleToAllDepts,
        attachment: {
          id: attachmentInfo.id,
          fileName: attachmentInfo.fileName
        },
        updatedBy: {
          id: user.sub,
          name: user.displayName || user.scope?.displayName || user.name || "Unknown User"
        },
        timestamp: new Date().toISOString()
      });

      return reply.send({
        success: true,
        message: "Attachment deleted successfully"
      });
    } catch (error) {
      console.error("Error deleting attachment:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to delete attachment"
      });
    }
  });


  // Create comment - Project members only
  app.post("/v1/projects/:id/comments", {
    schema: {
      tags: ["comments"],
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
          body: { type: 'string', minLength: 1, maxLength: 2000 },
          taskId: { type: 'string' }
        },
        required: ['body']
      }
      // Remove restrictive response schema that causes JSON serialization issues
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await requireFacultyOrStudent(req);
      const { id: projectId } = req.params;
      const { body, taskId } = req.body;

      // Verify project membership
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          applications: {
            where: { 
              status: 'ACCEPTED',
              studentId: user.sub 
            }
          }
        }
      });

      if (!project) {
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      const isAuthor = project.authorId === user.sub;
      const isAcceptedMember = project.applications.length > 0;

      if (!isAuthor && !isAcceptedMember) {
        return reply.status(403).send({
          success: false,
          error: "Access denied. You must be a project member."
        });
      }

      // If taskId is provided, verify it belongs to this project
      if (taskId) {
        const task = await prisma.projectTask.findFirst({
          where: { 
            id: taskId,
            projectId 
          }
        });

        if (!task) {
          return reply.status(404).send({
            success: false,
            error: "Task not found in this project"
          });
        }
      }

      const comment = await prisma.comment.create({
        data: {
          projectId,
          taskId: taskId || null,
          authorId: user.sub,
          authorName: user.displayName || user.scope.displayName || user.name || "Unknown User",
          body
        }
      });

      console.debug(`[POST /v1/projects/${projectId}/comments] Created comment:`, {
        commentId: comment.id,
        authorId: comment.authorId,
        authorName: comment.authorName,
        projectId: comment.projectId,
        taskId: comment.taskId,
        bodyLength: comment.body.length,
        requestTaskId: taskId,
        isProjectLevelComment: !taskId
      });

      // Emit WebSocket event for new comment
      emitProjectUpdate({
        type: 'comment-added',
        projectId,
        collegeId: project.collegeId,
        departments: project.departments,
        visibleToAllDepts: project.visibleToAllDepts,
        comment: {
          id: comment.id,
          authorId: comment.authorId,
          authorName: comment.authorName,
          body: comment.body,
          createdAt: comment.createdAt,
          taskId: comment.taskId
        },
        createdBy: {
          id: user.sub,
          name: user.displayName || "Unknown User"
        },
        timestamp: new Date().toISOString()
      });

      // Invalidate project-related caches after comment creation
      await CacheInvalidation.invalidateByEntity('project', projectId, 'update', {
        collegeId: project.collegeId
      });

      return reply.status(201).send({
        success: true,
        data: { comment }
      });
    } catch (error) {
      console.error("Error creating comment:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to create comment"
      });
    }
  });
}
