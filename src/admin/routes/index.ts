import { FastifyInstance } from 'fastify';
import headAdminRoutes from './headAdmin.routes';
import deptAdminRoutes from './deptAdmin.routes';
import placementsAdminRoutes from './placementsAdmin.routes';
import { requireHeadAdmin } from '../middleware/adminAuth';
import { prisma } from '../../db';
import { AuditLogger } from '../utils/auditLogger';

/**
 * Register all admin routes for projects service
 */
export async function adminRoutes(app: FastifyInstance) {
  // Register HEAD_ADMIN routes
  await app.register(headAdminRoutes);
  
  // Register DEPT_ADMIN routes
  await app.register(deptAdminRoutes);
  
  // Register PLACEMENTS_ADMIN routes
  await app.register(placementsAdminRoutes);

  // DEPRECATED: Legacy compatibility route (preserving existing functionality)
  // Use /v1/admin/head/projects instead
  app.get("/v1/admin/projects", {
    preHandler: async (request, reply) => {
      // Add deprecation warning header
      reply.header('X-API-Deprecated', 'true');
      reply.header('X-API-Deprecation-Info', 'Use /v1/admin/head/projects instead');
      reply.header('X-API-Sunset-Date', '2025-12-31');
      
      const adminAuth = await requireHeadAdmin(request);
      (request as any).adminAuth = adminAuth;
    },
    schema: { tags: ["admin"] }
  }, async (request, reply) => {
    const adminAuth = (request as any).adminAuth;
    const { page = 1, limit = 20, status, progressStatus, collegeId, authorId, q } = request.query as any;
    
    const where: any = { archivedAt: null };
    if (adminAuth.scope.collegeId && adminAuth.roles.includes("HEAD_ADMIN")) {
      where.collegeId = adminAuth.scope.collegeId;
    }
    if (status) where.moderationStatus = status;
    if (progressStatus) where.progressStatus = progressStatus;
    if (collegeId) where.collegeId = collegeId;
    if (authorId) where.authorId = authorId;
    if (q) {
      // Sanitize search input to prevent injection attacks
      const sanitizedQuery = q.replace(/[%_\\]/g, '\\$&').substring(0, 100);
      where.OR = [
        { title: { contains: sanitizedQuery, mode: 'insensitive' } },
        { description: { contains: sanitizedQuery, mode: 'insensitive' } }
      ];
    }

    const skip = (page - 1) * limit;
    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where, skip, take: limit, orderBy: { createdAt: 'desc' },
        include: { applications: true, _count: { select: { applications: true } } }
      }),
      prisma.project.count({ where })
    ]);

    await AuditLogger.logAnalyticsView(
      adminAuth.userId, adminAuth.name || 'Unknown Admin', 'PROJECT_LIST',
      { page, limit }, adminAuth.scope.collegeId, request
    );

    return {
      success: true, data: projects,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  });

  // DEPRECATED: Legacy moderation endpoint
  // Use /v1/admin/head/projects/:projectId/moderate instead
  app.patch("/v1/admin/projects/:projectId/moderate", {
    preHandler: async (request, reply) => {
      // Add deprecation warning header
      reply.header('X-API-Deprecated', 'true');
      reply.header('X-API-Deprecation-Info', 'Use /v1/admin/head/projects/:projectId/moderate instead');
      reply.header('X-API-Sunset-Date', '2025-12-31');
      
      const adminAuth = await requireHeadAdmin(request);
      (request as any).adminAuth = adminAuth;
    },
    schema: { tags: ["admin"] }
  }, async (request, reply) => {
    const adminAuth = (request as any).adminAuth;
    const { projectId } = request.params as { projectId: string };
    const { action, reason } = request.body as { action: string; reason?: string };

    const currentProject = await prisma.project.findUnique({ where: { id: projectId } });
    if (!currentProject) {
      return reply.status(404).send({ success: false, message: 'Project not found' });
    }

    if (adminAuth.scope.collegeId && currentProject.collegeId !== adminAuth.scope.collegeId) {
      return reply.status(403).send({ success: false, message: 'Access denied' });
    }

    let updateData: any = {};
    switch (action) {
      case 'APPROVE': updateData.moderationStatus = 'APPROVED'; break;
      case 'REJECT': updateData.moderationStatus = 'REJECTED'; break;
      case 'ARCHIVE': updateData.archivedAt = new Date(); break;
    }

    const updatedProject = await prisma.project.update({
      where: { id: projectId }, data: updateData
    });

    await AuditLogger.logProjectModeration(
      adminAuth.userId, adminAuth.name || 'Unknown Admin', projectId,
      currentProject, updatedProject, action, reason, request
    );

    return {
      success: true, data: updatedProject,
      message: `Project ${action.toLowerCase()}d successfully`
    };
  });

  // Health check for admin routes
  app.get('/v1/admin/health', async (request, reply) => {
    return {
      status: 'ok',
      service: 'projects-admin-routes',
      timestamp: new Date().toISOString(),
      routes: {
        headAdmin: 'available',
        deptAdmin: 'available',
        placementsAdmin: 'available'
      }
    };
  });
}

export default adminRoutes;
