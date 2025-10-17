import { ApplicationStatus } from '@prisma/client';

// Admin authentication types
export interface AdminAuthPayload {
  userId: string;
  sub: string;
  name?: string;
  email?: string;
  roles: string[];
  scope: {
    collegeId?: string;
    department?: string;
    displayName?: string;
    avatar?: string;
  };
}

// Admin permission levels
export type AdminRole = "HEAD_ADMIN" | "DEPT_ADMIN" | "PLACEMENTS_ADMIN" | "SUPER_ADMIN";

// Admin context for requests
export interface AdminContext {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  collegeId: string;
  department?: string;
  ipAddress?: string;
  userAgent?: string;
}

// Project management interfaces
export interface ProjectModerationRequest {
  action: "APPROVE" | "REJECT" | "ARCHIVE";
  reason?: string;
  moderationStatus?: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
}

export interface ProjectUpdateRequest {
  title?: string;
  description?: string;
  projectDuration?: string;
  skills?: string[];
  departments?: string[];
  visibleToAllDepts?: boolean;
  projectType?: "PROJECT" | "RESEARCH" | "PAPER_PUBLISH" | "OTHER";
  maxStudents?: number;
  deadline?: string;
  tags?: string[];
  requirements?: string[];
  outcomes?: string[];
  progressStatus?: "OPEN" | "IN_PROGRESS" | "COMPLETED";
}

export interface BulkProjectOperation {
  projectIds: string[];
  action: "APPROVE" | "REJECT" | "ARCHIVE" | "STATUS_UPDATE";
  reason?: string;
  progressStatus?: "OPEN" | "IN_PROGRESS" | "COMPLETED";
  moderationStatus?: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
}

export interface ApplicationStatusUpdate {
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  reason?: string;
  feedback?: string;
}

export interface BulkApplicationOperation {
  applicationIds: string[];
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  reason?: string;
  feedback?: string;
}

// Analytics interfaces
export interface ProjectAnalytics {
  totalProjects: number;
  projectsByStatus: {
    pending: number;
    approved: number;
    rejected: number;
    completed: number;
  };
  projectsByType: Record<string, number>;
  projectsByDepartment: Record<string, number>;
  applicationStats: {
    totalApplications: number;
    acceptanceRate: number;
    averageApplicationsPerProject: number;
  };
  engagementMetrics: {
    activeProjects: number;
    completionRate: number;
    averageProjectDuration: number;
  };
}

export interface DepartmentProjectAnalytics {
  departmentName: string;
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  studentParticipation: number;
  facultyEngagement: number;
  skillsDeveloped: string[];
}

export interface PlacementProjectAnalytics {
  industryRelevantProjects: number;
  skillBasedMatching: {
    totalMatches: number;
    successRate: number;
    topSkills: string[];
  };
  placementCorrelation: {
    projectsToPlacement: number;
    averageSkillsGained: number;
    industryAlignment: number;
  };
}

// Filtering and pagination
export interface ProjectFilters {
  search?: string;
  collegeId?: string;
  department?: string;
  authorId?: string;
  moderationStatus?: string[];
  progressStatus?: string[];
  projectType?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
  deadlineAfter?: Date;
  deadlineBefore?: Date;
  minApplications?: number;
  maxApplications?: number;
  hasAcceptedStudents?: boolean;
  tags?: string[];
  skills?: string[];
  isOverdue?: boolean;
  capacityStatus?: "full" | "available" | "empty";
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// Audit log types
export type ProjectAuditAction = 
  | "LOGIN" | "LOGOUT"
  | "MODERATE_PROJECT_APPROVE" | "MODERATE_PROJECT_REJECT" | "MODERATE_PROJECT_ARCHIVE"
  | "UPDATE_PROJECT_STATUS" | "BULK_PROJECT_UPDATE"
  | "UPDATE_APPLICATION_STATUS" | "BULK_APPLICATION_UPDATE"
  | "EXPORT_DATA" | "GENERATE_REPORT"
  | "VIEW_ANALYTICS";

export interface AuditLogData {
  adminId: string;
  adminName: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: any;
  newValues?: any;
  reason?: string;
  collegeId?: string;
}

export interface AuditLogEntry {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  collegeId?: string;
  createdAt: Date;
}

// Response interfaces
export interface AdminResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface BulkOperationResult {
  totalProcessed: number;
  successful: number;
  failed: number;
  errors: Array<{
    index: number;
    error: string;
    data?: any;
  }>;
}

// Admin limits and constraints
export interface AdminLimits {
  MAX_BULK_OPERATION_SIZE: number;
  MAX_EXPORT_RECORDS: number;
  AUDIT_LOG_RETENTION_DAYS: number;
}

export const ADMIN_LIMITS: AdminLimits = {
  MAX_BULK_OPERATION_SIZE: 50,
  MAX_EXPORT_RECORDS: 10000,
  AUDIT_LOG_RETENTION_DAYS: 730, // 2 years
};

// Permission matrix
export interface AdminPermissions {
  canModerateProjects: boolean;
  canManageApplications: boolean;
  canViewAnalytics: boolean;
  canExportData: boolean;
  canBulkOperations: boolean;
  canAccessAllDepartments: boolean;
  scope: "GLOBAL" | "COLLEGE" | "DEPARTMENT";
}

// Integration interfaces
export interface ProfileServiceIntegration {
  awardProjectBadge: (userId: string, projectId: string, badgeType: string) => Promise<void>;
  checkProfileCompletion: (userId: string) => Promise<boolean>;
  getStudentSkills: (userId: string) => Promise<string[]>;
}

export interface NetworkServiceIntegration {
  createProjectPost: (projectId: string, milestone: string) => Promise<void>;
  notifyProjectUpdate: (projectId: string, message: string) => Promise<void>;
}

// Export configuration
export interface ExportConfig {
  format: "csv" | "excel";
  fields?: string[];
  filters: ProjectFilters;
  includeApplications?: boolean;
  includeComments?: boolean;
}
