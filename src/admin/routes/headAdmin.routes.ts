import { FastifyInstance } from 'fastify';
import { requireHeadAdmin } from '../middleware/adminAuth';
import { HeadAdminController } from '../controllers/HeadAdminController';
import { 
  validateProjectModeration, 
  validateBulkProjectOperation, 
  validateApplicationStatusUpdate,
  validateBulkApplicationOperation,
  validateProjectUpdate,
  validateAdminQueryParams
} from '../../middlewares/adminValidation';
import { adminExportRateLimit, adminBulkRateLimit } from '../../middlewares/adminRateLimit';

export async function headAdminRoutes(app: FastifyInstance) {
  // Apply admin authentication to all routes
  app.addHook('preHandler', async (request, reply) => {
    const adminAuth = await requireHeadAdmin(request);
    (request as any).adminAuth = adminAuth;
  });

  // Dashboard
  app.get('/v1/admin/head/dashboard', {
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.getDashboard);

  // Project Management
  app.get('/v1/admin/head/projects', {
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.getProjects);

  app.get('/v1/admin/head/projects/:projectId', {
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.getProject);

  // Project Edit/Update
  app.put('/v1/admin/head/projects/:projectId', {
    preHandler: [validateProjectUpdate],
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.updateProject);

  // Project Delete
  app.delete('/v1/admin/head/projects/:projectId', {
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.deleteProject);

  app.patch('/v1/admin/head/projects/:projectId/moderate', {
    preHandler: [validateProjectModeration],
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.moderateProject);

  app.post('/v1/admin/head/projects/bulk', {
    preHandler: [adminBulkRateLimit, validateBulkProjectOperation],
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.bulkProjectOperation);

  // Application Management
  app.get('/v1/admin/head/applications', {
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.getApplications);

  app.patch('/v1/admin/head/applications/:applicationId', {
    preHandler: [validateApplicationStatusUpdate],
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.updateApplicationStatus);

  app.post('/v1/admin/head/applications/bulk', {
    preHandler: [adminBulkRateLimit, validateBulkApplicationOperation],
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.bulkApplicationUpdate);

  app.get('/v1/admin/head/projects/:projectId/applications', {
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.getProjectApplications);

  // Analytics
  app.get('/v1/admin/head/analytics', {
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.getAnalytics);

  // Data Export
  app.get('/v1/admin/head/export', {
    preHandler: [adminExportRateLimit, validateAdminQueryParams],
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.exportData);

  // Enhanced Applications Export
  app.get('/v1/admin/head/export/applications', {
    preHandler: [adminExportRateLimit, validateAdminQueryParams],
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.exportApplications);

  // Audit Logs
  app.get('/v1/admin/head/audit-logs', {
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.getAuditLogs);

  // Project Activity Logs
  app.get('/v1/admin/head/projects/:projectId/activity', {
    schema: { tags: ['head-admin'] }
  }, HeadAdminController.getProjectActivity);
}

export default headAdminRoutes;
