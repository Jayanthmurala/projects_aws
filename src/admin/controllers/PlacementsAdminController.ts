import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminProjectService } from '../services/AdminProjectService';
import { AdminApplicationService } from '../services/AdminApplicationService';
import { AuditLogger } from '../utils/auditLogger';
import { 
  ProjectFilters, 
  PaginationParams, 
  ApplicationStatusUpdate,
  AdminResponse 
} from '../types/adminTypes';

export class PlacementsAdminController {
  /**
   * Get PLACEMENTS_ADMIN dashboard data
   */
  static async getDashboard(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;

      const [
        placementProjects,
        studentApplications,
        industryProjects
      ] = await Promise.all([
        AdminProjectService.getProjectAnalytics(adminAuth),
        AdminApplicationService.getApplicationAnalytics(adminAuth),
        AdminProjectService.getProjects(
          { 
            projectType: ['PROJECT'], // Focus on industry projects
            tags: ['placement', 'industry', 'internship']
          },
          { page: 1, limit: 5, sortBy: 'createdAt', sortOrder: 'desc' },
          adminAuth
        )
      ]);

      await AuditLogger.logLogin(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: {
          placementAnalytics: placementProjects,
          applicationAnalytics: studentApplications,
          industryProjects: industryProjects.projects,
          placementMetrics: {
            totalProjects: placementProjects.totalProjects,
            industryProjects: industryProjects.projects.length,
            studentApplications: studentApplications.totalApplications,
            placementRelevantProjects: placementProjects.projectsByType['PROJECT'] || 0
          }
        }
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load dashboard'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get placement-relevant projects
   */
  static async getProjects(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const query = request.query as any;

      // Focus on placement-relevant projects
      const filters: ProjectFilters = {
        search: query.search,
        // Prioritize industry-relevant project types
        projectType: query.projectType ? query.projectType.split(',') : ['PROJECT'],
        moderationStatus: query.moderationStatus ? query.moderationStatus.split(',') : undefined,
        progressStatus: query.progressStatus ? query.progressStatus.split(',') : undefined,
        department: query.department,
        authorId: query.authorId,
        // Focus on placement-relevant tags
        tags: query.tags ? query.tags.split(',') : ['placement', 'industry', 'internship', 'startup'],
        skills: query.skills ? query.skills.split(',') : undefined,
        isOverdue: query.isOverdue === 'true',
        createdAfter: query.createdAfter ? new Date(query.createdAfter) : undefined,
        createdBefore: query.createdBefore ? new Date(query.createdBefore) : undefined
      };

      const pagination: PaginationParams = {
        page: parseInt(query.page) || 1,
        limit: parseInt(query.limit) || 20,
        sortBy: query.sortBy || 'createdAt',
        sortOrder: query.sortOrder || 'desc'
      };

      const result = await AdminProjectService.getProjects(filters, pagination, adminAuth);

      // Enhance projects with placement relevance score
      const enhancedProjects = result.projects.map(project => ({
        ...project,
        placementRelevance: this.calculatePlacementRelevance(project),
        industryAlignment: this.getIndustryAlignment((project as any).skills || [])
      }));

      const response: AdminResponse = {
        success: true,
        data: enhancedProjects,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch projects'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get student applications with placement focus
   */
  static async getStudentApplications(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const query = request.query as any;

      const filters = {
        status: query.status ? query.status.split(',') : undefined,
        studentDepartment: query.studentDepartment,
        projectId: query.projectId,
        studentId: query.studentId,
        appliedAfter: query.appliedAfter ? new Date(query.appliedAfter) : undefined,
        appliedBefore: query.appliedBefore ? new Date(query.appliedBefore) : undefined
      };

      const pagination = {
        page: parseInt(query.page) || 1,
        limit: parseInt(query.limit) || 20,
        sortBy: query.sortBy || 'appliedAt',
        sortOrder: query.sortOrder || 'desc'
      };

      const result = await AdminApplicationService.getApplications(filters, pagination, adminAuth);

      // Enhance applications with placement insights
      const enhancedApplications = result.applications.map(app => ({
        ...app,
        placementPotential: this.assessPlacementPotential(app),
        skillMatch: this.calculateSkillMatch((app.project as any).skills || [])
      }));

      const response: AdminResponse = {
        success: true,
        data: enhancedApplications,
        pagination: result.pagination
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch applications'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Update application status with placement focus
   */
  static async updateApplicationStatus(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { applicationId } = request.params as { applicationId: string };
      const statusUpdate = request.body as ApplicationStatusUpdate;

      const result = await AdminApplicationService.updateApplicationStatus(
        applicationId, 
        statusUpdate, 
        adminAuth
      );

      await AuditLogger.logApplicationStatusChange(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        applicationId,
        result.oldStatus,
        result.newStatus,
        result.reason,
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: result.application,
        message: `Application status updated to ${result.newStatus}`
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update application status'
      };
      return reply.status(400).send(response);
    }
  }

  /**
   * Get placement analytics
   */
  static async getPlacementAnalytics(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { type, timeRange } = request.query as { type?: string; timeRange?: string };

      let analyticsData;

      switch (type) {
        case 'skills':
          analyticsData = await this.getSkillDemandAnalytics(adminAuth, timeRange);
          break;
        case 'industry':
          analyticsData = await this.getIndustryProjectAnalytics(adminAuth, timeRange);
          break;
        case 'placement':
          analyticsData = await this.getPlacementCorrelationAnalytics(adminAuth, timeRange);
          break;
        default:
          // Combined placement analytics
          const [projectAnalytics, applicationAnalytics] = await Promise.all([
            AdminProjectService.getProjectAnalytics(adminAuth, timeRange),
            AdminApplicationService.getApplicationAnalytics(adminAuth, timeRange)
          ]);
          analyticsData = { 
            projects: projectAnalytics, 
            applications: applicationAnalytics,
            placementInsights: await this.getPlacementInsights(adminAuth)
          };
      }

      await AuditLogger.logAnalyticsView(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        `placement_${type || 'combined'}`,
        { timeRange },
        adminAuth.scope.collegeId,
        request
      );

      const response: AdminResponse = {
        success: true,
        data: analyticsData
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch analytics'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Get skill-based project matching
   */
  static async getSkillBasedMatching(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { skills } = request.query as { skills?: string };

      if (!skills) {
        const response: AdminResponse = {
          success: false,
          message: 'Skills parameter is required'
        };
        return reply.status(400).send(response);
      }

      const skillArray = skills.split(',');
      
      const matchingProjects = await AdminProjectService.getProjects(
        { 
          skills: skillArray,
          moderationStatus: ['APPROVED'],
          progressStatus: ['OPEN', 'IN_PROGRESS']
        },
        { page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' },
        adminAuth
      );

      // Calculate skill match scores
      const scoredProjects = matchingProjects.projects.map(project => ({
        ...project,
        skillMatchScore: this.calculateSkillMatchScore(skillArray, project.skills || []),
        recommendationReason: this.getRecommendationReason(skillArray, project.skills || [])
      })).sort((a, b) => b.skillMatchScore - a.skillMatchScore);

      const response: AdminResponse = {
        success: true,
        data: {
          searchSkills: skillArray,
          matchingProjects: scoredProjects,
          summary: {
            totalMatches: scoredProjects.length,
            highMatches: scoredProjects.filter(p => p.skillMatchScore >= 80).length,
            mediumMatches: scoredProjects.filter(p => p.skillMatchScore >= 60 && p.skillMatchScore < 80).length,
            lowMatches: scoredProjects.filter(p => p.skillMatchScore < 60).length
          }
        }
      };

      return reply.send(response);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to perform skill-based matching'
      };
      return reply.status(500).send(response);
    }
  }

  /**
   * Export placement data
   */
  static async exportPlacementData(request: FastifyRequest, reply: FastifyReply) {
    try {
      const adminAuth = (request as any).adminAuth;
      const { type, format } = request.query as { type: string; format?: string };

      let csvContent: string;
      let filename: string;

      switch (type) {
        case 'placement-projects':
          const projects = await AdminProjectService.getProjects(
            { projectType: ['PROJECT'], tags: ['placement', 'industry'] },
            { page: 1, limit: 10000, sortBy: 'createdAt', sortOrder: 'desc' },
            adminAuth
          );

          const projectHeaders = ['Title', 'Author', 'Department', 'Skills', 'Applications', 'Status', 'Industry Relevance'];
          const projectRows = projects.projects.map(project => [
            project.title,
            project.authorName,
            project.authorDepartment || '',
            (project.skills || []).join('; '),
            project.applicationCount || 0,
            project.moderationStatus,
            this.getIndustryAlignment(project.skills || [])
          ]);

          csvContent = [
            projectHeaders.join(','),
            ...projectRows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
          ].join('\n');

          filename = `placement-projects-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        case 'student-applications':
          const applications = await AdminApplicationService.getApplications(
            {},
            { page: 1, limit: 10000, sortBy: 'appliedAt', sortOrder: 'desc' },
            adminAuth
          );

          const appHeaders = ['Student Name', 'Department', 'Project Title', 'Skills Required', 'Status', 'Placement Potential'];
          const appRows = applications.applications.map(app => [
            app.studentName,
            app.studentDepartment,
            app.project.title,
            ((app.project as any).skills || []).join('; '),
            app.status,
            this.assessPlacementPotential(app)
          ]);

          csvContent = [
            appHeaders.join(','),
            ...appRows.map((row: any[]) => row.map((cell: any) => `"${cell}"`).join(','))
          ].join('\n');

          filename = `student-applications-${new Date().toISOString().split('T')[0]}.csv`;
          break;

        default:
          throw new Error('Invalid export type');
      }

      await AuditLogger.logDataExport(
        adminAuth.userId,
        adminAuth.name || adminAuth.email || 'Unknown Admin',
        `placement_${type}`,
        csvContent.split('\n').length - 1,
        { format: format || 'csv' },
        adminAuth.scope.collegeId,
        request
      );

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(csvContent);
    } catch (error) {
      const response: AdminResponse = {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to export data'
      };
      return reply.status(400).send(response);
    }
  }

  // Private helper methods
  private static calculatePlacementRelevance(project: any): number {
    let score = 0;
    
    // Project type relevance
    if (project.projectType === 'PROJECT') score += 30;
    
    // Tag relevance
    const placementTags = ['placement', 'industry', 'internship', 'startup', 'corporate'];
    const matchingTags = (project.tags || []).filter((tag: string) => 
      placementTags.some(pt => tag.toLowerCase().includes(pt))
    );
    score += matchingTags.length * 15;
    
    // Skill relevance (industry-relevant skills)
    const industrySkills = ['javascript', 'python', 'react', 'node.js', 'sql', 'aws', 'docker'];
    const matchingSkills = (project.skills || []).filter((skill: string) => 
      industrySkills.some(is => skill.toLowerCase().includes(is.toLowerCase()))
    );
    score += matchingSkills.length * 10;
    
    return Math.min(score, 100);
  }

  private static getIndustryAlignment(skills: string[]): string {
    const webDevSkills = ['javascript', 'react', 'angular', 'vue', 'html', 'css'];
    const backendSkills = ['node.js', 'python', 'java', 'spring', 'express'];
    const dataSkills = ['python', 'sql', 'pandas', 'numpy', 'machine learning'];
    const cloudSkills = ['aws', 'azure', 'docker', 'kubernetes'];

    const skillsLower = skills.map(s => s.toLowerCase());
    
    if (skillsLower.some(s => webDevSkills.includes(s))) return 'Web Development';
    if (skillsLower.some(s => backendSkills.includes(s))) return 'Backend Development';
    if (skillsLower.some(s => dataSkills.includes(s))) return 'Data Science';
    if (skillsLower.some(s => cloudSkills.includes(s))) return 'Cloud Computing';
    
    return 'General Technology';
  }

  private static assessPlacementPotential(application: any): string {
    const project = application.project;
    const relevanceScore = this.calculatePlacementRelevance(project);
    
    if (relevanceScore >= 80) return 'High';
    if (relevanceScore >= 60) return 'Medium';
    return 'Low';
  }

  private static calculateSkillMatch(projectSkills: string[]): number {
    // This would ideally fetch student skills from profile service
    // For now, return a mock score
    return Math.floor(Math.random() * 100);
  }

  private static calculateSkillMatchScore(searchSkills: string[], projectSkills: string[]): number {
    if (searchSkills.length === 0 || projectSkills.length === 0) return 0;
    
    const matches = searchSkills.filter(skill => 
      projectSkills.some(pSkill => 
        pSkill.toLowerCase().includes(skill.toLowerCase()) ||
        skill.toLowerCase().includes(pSkill.toLowerCase())
      )
    );
    
    return Math.round((matches.length / searchSkills.length) * 100);
  }

  private static getRecommendationReason(searchSkills: string[], projectSkills: string[]): string {
    const matches = searchSkills.filter(skill => 
      projectSkills.some(pSkill => 
        pSkill.toLowerCase().includes(skill.toLowerCase())
      )
    );
    
    if (matches.length === 0) return 'Related skills may be beneficial';
    if (matches.length === 1) return `Matches your ${matches[0]} skill`;
    return `Matches ${matches.length} of your skills: ${matches.join(', ')}`;
  }

  private static async getSkillDemandAnalytics(adminAuth: any, timeRange?: string) {
    // Mock implementation - would integrate with industry data
    return {
      trendingSkills: ['React', 'Python', 'AWS', 'Docker', 'Machine Learning'],
      demandGrowth: {
        'React': 25,
        'Python': 30,
        'AWS': 40,
        'Docker': 35,
        'Machine Learning': 50
      }
    };
  }

  private static async getIndustryProjectAnalytics(adminAuth: any, timeRange?: string) {
    const projects = await AdminProjectService.getProjectAnalytics(adminAuth, timeRange);
    return {
      ...projects,
      industryAlignment: {
        'Web Development': 40,
        'Data Science': 25,
        'Cloud Computing': 20,
        'Mobile Development': 15
      }
    };
  }

  private static async getPlacementCorrelationAnalytics(adminAuth: any, timeRange?: string) {
    // Mock implementation - would correlate with actual placement data
    return {
      projectsToPlacement: 75, // % of students who got placed after project completion
      skillsImpact: 85, // % improvement in placement chances with relevant skills
      industryProjects: 90 // % placement rate for industry-relevant projects
    };
  }

  private static async getPlacementInsights(adminAuth: any) {
    return {
      topSkillsForPlacement: ['React', 'Python', 'AWS', 'SQL', 'Docker'],
      industryDemand: {
        'Software Development': 45,
        'Data Science': 25,
        'Cloud Engineering': 20,
        'DevOps': 10
      },
      recommendations: [
        'Focus on full-stack development projects',
        'Encourage cloud computing skills',
        'Promote industry collaboration projects'
      ]
    };
  }
}
