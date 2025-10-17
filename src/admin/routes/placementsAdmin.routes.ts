import { FastifyInstance } from 'fastify';
import { requirePlacementsAdmin } from '../middleware/adminAuth';
import { PlacementsAdminController } from '../controllers/PlacementsAdminController';

export async function placementsAdminRoutes(app: FastifyInstance) {
  // Apply admin authentication to all routes
  app.addHook('preHandler', async (request, reply) => {
    const adminAuth = await requirePlacementsAdmin(request);
    (request as any).adminAuth = adminAuth;
  });

  // Dashboard
  app.get('/v1/admin/placements/dashboard', {
    schema: { tags: ['placements-admin'] }
  }, PlacementsAdminController.getDashboard);

  // Placement-Relevant Project Management
  app.get('/v1/admin/placements/projects', {
    schema: { tags: ['placements-admin'] }
  }, PlacementsAdminController.getProjects);

  // Student Application Management (Placement Focus)
  app.get('/v1/admin/placements/applications', {
    schema: { tags: ['placements-admin'] }
  }, PlacementsAdminController.getStudentApplications);

  app.patch('/v1/admin/placements/applications/:applicationId', {
    schema: { tags: ['placements-admin'] }
  }, PlacementsAdminController.updateApplicationStatus);

  // Placement Analytics
  app.get('/v1/admin/placements/analytics', {
    schema: { tags: ['placements-admin'] }
  }, PlacementsAdminController.getPlacementAnalytics);

  // Skill-Based Project Matching
  app.get('/v1/admin/placements/skill-matching', {
    schema: { tags: ['placements-admin'] }
  }, PlacementsAdminController.getSkillBasedMatching);

  // Industry Insights
  app.get('/v1/admin/placements/industry-insights', {
    schema: { tags: ['placements-admin'] }
  }, async (request, reply) => {
    try {
      const insights = {
        trendingSkills: [
          { skill: 'React', demand: 95, growth: 25 },
          { skill: 'Python', demand: 90, growth: 30 },
          { skill: 'AWS', demand: 85, growth: 40 }
        ],
        industryDemand: {
          'Software Development': { demand: 45, avgSalary: 80000 },
          'Data Science': { demand: 25, avgSalary: 95000 }
        },
        recommendations: [
          'Focus on full-stack development projects',
          'Encourage cloud computing skills development'
        ]
      };
      return reply.send({ success: true, data: insights });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch industry insights'
      });
    }
  });

  // Student Placement Readiness
  app.get('/v1/admin/placements/student-readiness', {
    schema: { tags: ['placements-admin'] }
  }, async (request, reply) => {
    try {
      const readinessData = {
        totalStudents: 150,
        readyStudents: 120,
        readinessRate: 80,
        recommendations: [
          'Organize React workshops for 45 students',
          'Provide AWS certification training'
        ]
      };
      return reply.send({ success: true, data: readinessData });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to assess student readiness'
      });
    }
  });

  // Data Export (Placement Focus)
  app.get('/v1/admin/placements/export', {
    schema: { tags: ['placements-admin'] }
  }, PlacementsAdminController.exportPlacementData);

  // Placement Reports
  app.get('/v1/admin/placements/reports/summary', {
    schema: { tags: ['placements-admin'] }
  }, async (request, reply) => {
    try {
      const summaryReport = {
        reportPeriod: '90d',
        summary: {
          totalProjects: 45,
          placementRelevantProjects: 32,
          studentParticipation: 180,
          placementCorrelation: 78
        },
        recommendations: [
          'Increase industry collaboration projects',
          'Focus on emerging technology skills'
        ]
      };
      return reply.send({ success: true, data: summaryReport });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to generate placement report'
      });
    }
  });
}

export default placementsAdminRoutes;
