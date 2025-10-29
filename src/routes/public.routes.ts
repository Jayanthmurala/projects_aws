import { FastifyInstance } from "fastify";
import { z } from "zod";
import { optionalAuth, canAccessProject } from "../middlewares/unifiedAuth";
import { getUserScope } from "../clients/profile";
import { prisma } from "../db";
import type { $Enums } from "@prisma/client";

export default async function publicRoutes(app: FastifyInstance) {
  
  // Test route removed for production security
  
  // Public projects listing - no authentication required
  app.get("/v1/projects/public", {
    schema: {
      tags: ["projects"],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          projectType: { type: 'string' },
          progressStatus: { type: 'string' },
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 }
        }
      },
      response: { 200: { type: 'object' } },
    },
  }, async (req: any, reply: any) => {
    try {
      const { q, projectType, progressStatus } = (req.query as any) as {
        q?: string; projectType?: string; progressStatus?: string; page?: number; limit?: number;
      };
      const page = Math.max(1, Number((req.query as any).page || 1));
      const limit = Math.min(100, Math.max(1, Number((req.query as any).limit || 20)));

      const andConditions: any[] = [
        { archivedAt: null },
        { moderationStatus: "APPROVED" }, // Only show approved projects publicly
        { visibleToAllDepts: true }, // Only show projects visible to all departments
      ];
      
      if (projectType) andConditions.push({ projectType });
      if (progressStatus) andConditions.push({ progressStatus });
      if (q) andConditions.push({ OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ] });

      const where: any = { AND: andConditions };
      const total = await prisma.project.count({ where });
      const projects = await prisma.project.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });

      // Get accepted students count for all projects
      const ids = projects.map((p: any) => p.id);
      const acceptedCounts = await prisma.appliedProject.groupBy({
        by: ['projectId'],
        where: { projectId: { in: ids }, status: 'ACCEPTED' as $Enums.ApplicationStatus },
        _count: { projectId: true },
      });
      const countsByProjectId: Record<string, number> = {};
      for (const count of acceptedCounts) {
        countsByProjectId[count.projectId] = count._count.projectId;
      }
      
      const projectsOut = projects.map((p: any) => ({
        ...p,
        acceptedStudentsCount: countsByProjectId[p.id] || 0,
      }));

      return reply.send({ 
        success: true,
        data: {
          projects: projectsOut, 
          pagination: {
            page, 
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error: any) {
      console.error('[ERROR] Failed to fetch public projects:', error);
      return reply.code(500).send({ 
        success: false,
        error: "Failed to fetch projects. Please try again later.",
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined
      });
    }
  });

  // Get single project details
  app.get("/v1/projects/:id", {
    schema: {
      tags: ["projects"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      // Important: allow all properties to avoid fast-json-stringify stripping
      response: { 
        200: { type: 'object', additionalProperties: true },
        404: { type: 'object', additionalProperties: true },
      }
    }
  }, async (req: any, reply: any) => {
    try {
      const user = await optionalAuth(req);
      const { id } = req.params;

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              applications: {
                where: { status: 'ACCEPTED' }
              }
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

      // Check if project is accessible
      if (project.moderationStatus !== 'APPROVED' || project.archivedAt) {
        // Only author and admins can see non-approved/archived projects
        if (!user || (project.authorId !== user.sub && !user.roles?.some(role => 
          ['HEAD_ADMIN', 'DEPT_ADMIN', 'SUPER_ADMIN'].includes(role)
        ))) {
          return reply.status(404).send({
            success: false,
            error: "Project not found"
          });
        }
      }

      // Check college/department access for authenticated users
      if (user && !canAccessProject(user, project)) {
        return reply.status(403).send({
          success: false,
          error: "You don't have access to this project"
        });
      }

      // Add application status for students
      let projectWithStatus = { ...project };
      if (user && user.roles?.includes("STUDENT")) {
        const userApplication = await prisma.appliedProject.findFirst({
          where: {
            projectId: id,
            studentId: user.sub
          }
        });

        projectWithStatus = {
          ...project,
          hasApplied: !!userApplication,
          myApplicationStatus: userApplication?.status || null
        } as any;
      }

      return reply.send({
        success: true,
        data: { project: projectWithStatus }
      });
    } catch (error) {
      console.error("Error fetching project:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to fetch project"
      });
    }
  });

  // Get project comments - Public for approved projects
  app.get("/v1/projects/:id/comments", {
    schema: {
      tags: ["comments"],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id']
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
      }
      // Remove restrictive response schema that might be causing JSON serialization issues
    }
  }, async (req: any, reply: any) => {
    console.log(`[GET /v1/projects/:id/comments] Route called with projectId: ${req.params.id}`);
    
    try {
      const user = await optionalAuth(req);
      const { id: projectId } = req.params;
      const { page = 1, limit = 20 } = req.query as any;
      
      console.log(`[GET /v1/projects/${projectId}/comments] Starting request processing...`);
      console.log(`[GET /v1/projects/${projectId}/comments] User:`, { hasUser: !!user, userId: user?.sub });

      // Check if project exists and is accessible
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          moderationStatus: true,
          archivedAt: true,
          authorId: true,
          collegeId: true,
          departments: true
        }
      });

      console.debug(`[GET /v1/projects/${projectId}/comments] Project check:`, {
        projectExists: !!project,
        projectId,
        moderationStatus: project?.moderationStatus,
        archivedAt: project?.archivedAt,
        authorId: project?.authorId,
        userId: user?.sub,
        isAuthor: project?.authorId === user?.sub,
        hasUser: !!user,
        userRoles: user?.roles
      });

      if (!project) {
        console.debug(`[GET /v1/projects/${projectId}/comments] Project not found in database`);
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }

      // Check accessibility - Allow project authors to access their own projects regardless of status
      const isAuthor = project.authorId === user?.sub;
      const isAdmin = user?.roles?.some(role => ['HEAD_ADMIN', 'DEPT_ADMIN', 'SUPER_ADMIN'].includes(role));
      const isApprovedPublic = project.moderationStatus === 'APPROVED' && !project.archivedAt;
      
      if (!isApprovedPublic && !isAuthor && !isAdmin) {
        console.debug(`[GET /v1/projects/${projectId}/comments] Access denied:`, {
          isApprovedPublic,
          isAuthor,
          isAdmin,
          moderationStatus: project.moderationStatus,
          archivedAt: project.archivedAt
        });
        return reply.status(404).send({
          success: false,
          error: "Project not found"
        });
      }
      
      console.debug(`[GET /v1/projects/${projectId}/comments] Access granted:`, {
        isApprovedPublic,
        isAuthor,
        isAdmin
      });

      // For project-level comments, filter out task-specific comments
      const whereClause = { 
        projectId,
        taskId: null  // Only project-level comments, not task comments
      };

      // First, let's check all comments for this project (without taskId filter)
      const allComments = await prisma.comment.findMany({
        where: { projectId },
        select: { id: true, taskId: true, authorId: true, body: true, createdAt: true }
      });

      console.debug(`[GET /v1/projects/${projectId}/comments] All comments in DB:`, {
        projectId,
        totalCommentsInDB: allComments.length,
        comments: allComments.map(c => ({
          id: c.id,
          taskId: c.taskId,
          authorId: c.authorId,
          bodyPreview: c.body.substring(0, 50),
          createdAt: c.createdAt
        }))
      });

      const comments = await prisma.comment.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      });

      const total = await prisma.comment.count({
        where: whereClause
      });

      console.debug(`[GET /v1/projects/${projectId}/comments] Filtered comments:`, {
        whereClause,
        filteredCount: comments.length,
        total,
        page,
        limit,
        comments: comments.map(c => ({
          id: c.id,
          taskId: c.taskId,
          authorId: c.authorId,
          bodyPreview: c.body.substring(0, 50)
        }))
      });

      console.log(`[GET /v1/projects/${projectId}/comments] Sending response with ${comments.length} comments`);
      
      // Send the full response with comments data
      return reply.send({
        success: true,
        data: {
          comments,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      console.error("Error fetching comments:", error);
      return reply.status(500).send({
        success: false,
        error: "Failed to fetch comments"
      });
    }
  });
}
