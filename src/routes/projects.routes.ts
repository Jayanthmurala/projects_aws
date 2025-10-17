import { FastifyInstance } from "fastify";
import { any, z } from "zod";
import { requireAuth, requireRole, optionalAuth } from "../middlewares/auth";
// Note: Using native JSON Schema validation instead of Zod schemas
// import { createProjectSchema, updateProjectSchema, applyProjectSchema, updateApplicationStatusSchema, createTaskSchema, updateTaskSchema, createAttachmentSchema } from "../schemas/apiSchemas";
import { prisma } from "../db";
import { getUserScope } from "../clients/profile";
import { emitProjectUpdate, emitApplicationUpdate } from "../utils/enhancedWebSocket";
import type { Prisma, $Enums } from "@prisma/client";

export default async function projectsRoutes(app: FastifyInstance) {
  // List projects in my college (scoped; visibility enforced later)
  app.get("/v1/projects", async (req: any, reply: any) => {
    try {
      const payload = await requireAuth(req);

      // Authenticated user - apply proper filters
      const userScope = await getUserScope(req, payload);
      
      const { collegeId, department } = userScope;
      const roles = (payload.roles || []) as string[];
      const isStudent = roles.includes("STUDENT");
      const isFaculty = roles.includes("FACULTY");
    

    const { q, projectType, progressStatus } = (req.query as any) as {
      q?: string; projectType?: string; progressStatus?: string; page?: number; limit?: number;
    };
    const page = Math.max(1, Number((req.query as any).page || 1));
    const limit = Math.min(100, Math.max(1, Number((req.query as any).limit || 20)));

    const andConditions: any[] = [
      { archivedAt: null },
    ];
    
    // Always add collegeId filter for authenticated users - this is critical for security
    if (!collegeId) {
      return reply.send({
        success: true,
        data: {
          projects: [],
          pagination: { page: 1, total: 0 }
        }
      });
    }
    
    andConditions.push({ collegeId: collegeId.toString() });
    
    if (projectType) andConditions.push({ projectType });
    if (progressStatus) andConditions.push({ progressStatus });
    if (q) {
      // Sanitize search input to prevent injection attacks
      const sanitizedQuery = q.replace(/[%_\\]/g, '\\$&').substring(0, 100);
      andConditions.push({ OR: [
        { title: { contains: sanitizedQuery, mode: "insensitive" } },
        { description: { contains: sanitizedQuery, mode: "insensitive" } },
      ] });
    }
    if (isStudent) {
      andConditions.push({ moderationStatus: "APPROVED" });
      
      // EXACT USER FLOW: Check visibility based on visibleToAllDepts flag
      if (department) {
        // Student has department - can see:
        // 1. Projects with visibleToAllDepts: true (visible to all students in college)
        // 2. Projects with visibleToAllDepts: false BUT student's department is in departments array
        andConditions.push({ OR: [
          { visibleToAllDepts: true },
          { 
            AND: [
              { visibleToAllDepts: false },
              { departments: { has: department } }
            ]
          }
        ] });
      } else {
        andConditions.push({ visibleToAllDepts: true });
      }
    }
    // Faculty follows same visibility rules as students
    if (isFaculty) {
      // Faculty can see approved projects OR their own projects (any status)
      andConditions.push({ OR: [
        { moderationStatus: "APPROVED" },
        { authorId: payload.sub }
      ] });
      
      // Faculty follows EXACT same department visibility logic as students
      if (department) {
        andConditions.push({ OR: [
          { visibleToAllDepts: true },
          { 
            AND: [
              { visibleToAllDepts: false },
              { departments: { has: department } }
            ]
          }
        ] });
      } else {
        andConditions.push({ visibleToAllDepts: true });
      }
    }

    const where: any = { AND: andConditions };
    
    const total = await prisma.project.count({ where });
    
    const projects = await prisma.project.findMany({
          where,
          include: {
            _count: {
              select: {
                applications: {
                  where: { status: 'ACCEPTED' as $Enums.ApplicationStatus }
                }
              }
            }
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        });

        // Transform projects to include accepted count directly
        const projectsOut = projects.map((p: any) => ({
          ...p,
          acceptedStudentsCount: p._count.applications,
          _count: undefined // Remove the _count object from response
        }));

        const response = {
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
        };
        return reply.code(200).send(response);
    } catch (error: any) {
      // Handle JWT expiration specifically
      if (error?.name === 'JWTExpired' || error?.code === 'ERR_JWT_EXPIRED') {
        return reply.code(401).send({ 
          error: 'Token expired',
          message: 'Please log in again'
        });
      }
      
      return reply.code(500).send({ 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined
      });
    }
  });

  // Get single project by ID - handled by public.routes.ts

  // My projects (FACULTY)
  app.get("/v1/projects/mine", {
    schema: { tags: ["projects"], response: { 200: z.any() } },
  }, async (req: any, reply: any) => {
    const payload = await requireAuth(req);
    requireRole(payload, ["FACULTY"]);
    const { collegeId } = await getUserScope(req, payload);
    const projects = await prisma.project.findMany({
      where: { authorId: payload.sub, collegeId, archivedAt: null },
      include: {
        _count: {
          select: {
            applications: {
              where: { status: 'ACCEPTED' as $Enums.ApplicationStatus }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
    });
    
    const projectsOut = projects.map((p: any) => ({
      ...p,
      acceptedStudentsCount: p._count.applications,
      _count: undefined
    }));
    
    return reply.send({ projects: projectsOut });
  });

  // Project creation - handled by faculty.routes.ts

  // Project update - handled by faculty.routes.ts

  // Project deletion - handled by faculty.routes.ts

  // Project application - handled by student.routes.ts

  // List applications for a project - handled by faculty.routes.ts

  // My applications - handled by student.routes.ts

  // Application status update - handled by faculty.routes.ts

  // Comments - handled by public.routes.ts

  // Comment creation - handled by public.routes.ts



  // Task creation - handled by collaboration.routes.ts

  // Task update - handled by collaboration.routes.ts

  // Task deletion - handled by collaboration.routes.ts

  // Attachments - handled by collaboration.routes.ts

  // Attachment creation - handled by collaboration.routes.ts
}
