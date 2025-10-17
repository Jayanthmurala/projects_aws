import { FastifyRequest } from "fastify";
import { verifyAccessToken } from "../../utils/jwt";
import { getUserScopeFromJWT } from "../../clients/auth";
import { AdminAuthPayload } from "../types/adminTypes";

// Base admin authentication
async function requireAdmin(req: FastifyRequest): Promise<AdminAuthPayload> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw { statusCode: 401, message: 'Missing or invalid authorization header' };
  }

  const token = authHeader.substring(7);
  try {
    const payload = await verifyAccessToken(token);
    const userScope = getUserScopeFromJWT(payload);
    
    // Check for admin roles
    if (!payload.roles || !Array.isArray(payload.roles)) {
      throw { statusCode: 403, message: 'No roles found in token' };
    }

    const adminRoles = ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'];
    if (!payload.roles.some((role: string) => adminRoles.includes(role))) {
      throw { statusCode: 403, message: 'Admin role required' };
    }

    const adminPayload: AdminAuthPayload = {
      userId: payload.sub,
      sub: payload.sub,
      name: payload.name,
      email: payload.email,
      roles: payload.roles,
      scope: {
        collegeId: userScope.collegeId?.toString(),
        department: userScope.department,
        displayName: userScope.displayName,
        avatar: userScope.avatar
      }
    };

    return adminPayload;
  } catch (error: any) {
    if (error.statusCode) throw error;
    throw { statusCode: 401, message: 'Invalid or expired token' };
  }
}

// HEAD_ADMIN middleware - college scoped
export async function requireHeadAdmin(req: FastifyRequest): Promise<AdminAuthPayload> {
  const payload = await requireAdmin(req);
  
  if (!payload.roles.includes("HEAD_ADMIN") && !payload.roles.includes("SUPER_ADMIN")) {
    throw { statusCode: 403, message: 'Head Admin access required' };
  }
  
  // HEAD_ADMIN must be associated with a college (unless SUPER_ADMIN)
  if (payload.roles.includes("HEAD_ADMIN") && !payload.scope.collegeId) {
    throw { statusCode: 403, message: 'Head Admin must be associated with a college' };
  }
  
  return payload;
}

// DEPT_ADMIN middleware - department scoped
export async function requireDeptAdmin(req: FastifyRequest): Promise<AdminAuthPayload> {
  const payload = await requireAdmin(req);
  
  if (!payload.roles.includes("DEPT_ADMIN") && 
      !payload.roles.includes("HEAD_ADMIN") && 
      !payload.roles.includes("SUPER_ADMIN")) {
    throw { statusCode: 403, message: 'Department Admin access required' };
  }
  
  // DEPT_ADMIN must be associated with college and department (unless higher admin)
  if (payload.roles.includes("DEPT_ADMIN") && 
      (!payload.scope.collegeId || !payload.scope.department)) {
    throw { statusCode: 403, message: 'Department Admin must be associated with college and department' };
  }
  
  return payload;
}

// PLACEMENTS_ADMIN middleware - placement focused
export async function requirePlacementsAdmin(req: FastifyRequest): Promise<AdminAuthPayload> {
  const payload = await requireAdmin(req);
  
  if (!payload.roles.includes("PLACEMENTS_ADMIN") && 
      !payload.roles.includes("HEAD_ADMIN") && 
      !payload.roles.includes("SUPER_ADMIN")) {
    throw { statusCode: 403, message: 'Placements Admin access required' };
  }
  
  // PLACEMENTS_ADMIN must be associated with a college (unless higher admin)
  if (payload.roles.includes("PLACEMENTS_ADMIN") && !payload.scope.collegeId) {
    throw { statusCode: 403, message: 'Placements Admin must be associated with a college' };
  }
  
  return payload;
}

// SUPER_ADMIN middleware - global access
export async function requireSuperAdmin(req: FastifyRequest): Promise<AdminAuthPayload> {
  const payload = await requireAdmin(req);
  
  if (!payload.roles.includes("SUPER_ADMIN")) {
    throw { statusCode: 403, message: 'Super Admin access required' };
  }
  
  return payload;
}

// Helper function to get college scope for filtering
export function getCollegeScope(admin: AdminAuthPayload): string | null {
  // SUPER_ADMIN has global access
  if (admin.roles.includes("SUPER_ADMIN")) {
    return null;
  }
  
  // HEAD_ADMIN, DEPT_ADMIN, and PLACEMENTS_ADMIN are college-scoped
  return admin.scope.collegeId || null;
}

// Helper function to get department scope for filtering
export function getDepartmentScope(admin: AdminAuthPayload): string | null {
  // SUPER_ADMIN and HEAD_ADMIN have access to all departments in their scope
  if (admin.roles.includes("SUPER_ADMIN") || admin.roles.includes("HEAD_ADMIN")) {
    return null;
  }
  
  // DEPT_ADMIN is department-scoped
  if (admin.roles.includes("DEPT_ADMIN")) {
    return admin.scope.department || null;
  }
  
  // PLACEMENTS_ADMIN has access to all departments (for placement purposes)
  return null;
}

// Check if admin can access specific college
export function canAccessCollege(admin: AdminAuthPayload, collegeId: string): boolean {
  if (admin.roles.includes("SUPER_ADMIN")) {
    return true;
  }
  
  return admin.scope.collegeId === collegeId;
}

// Check if admin can access specific department
export function canAccessDepartment(admin: AdminAuthPayload, collegeId: string, department: string): boolean {
  if (admin.roles.includes("SUPER_ADMIN")) {
    return true;
  }
  
  if (admin.roles.includes("HEAD_ADMIN") || admin.roles.includes("PLACEMENTS_ADMIN")) {
    return admin.scope.collegeId === collegeId;
  }
  
  if (admin.roles.includes("DEPT_ADMIN")) {
    return admin.scope.collegeId === collegeId && admin.scope.department === department;
  }
  
  return false;
}

// Check if admin can moderate project
export function canModerateProject(admin: AdminAuthPayload, project: any): boolean {
  if (admin.roles.includes("SUPER_ADMIN")) {
    return true;
  }
  
  // Must be in same college
  if (!canAccessCollege(admin, project.collegeId)) {
    return false;
  }
  
  // HEAD_ADMIN can moderate all projects in their college
  if (admin.roles.includes("HEAD_ADMIN")) {
    return true;
  }
  
  // DEPT_ADMIN can moderate projects in their department
  if (admin.roles.includes("DEPT_ADMIN")) {
    return project.authorDepartment === admin.scope.department;
  }
  
  // PLACEMENTS_ADMIN can moderate placement-relevant projects
  if (admin.roles.includes("PLACEMENTS_ADMIN")) {
    return project.projectType === "PROJECT" || project.tags?.includes("placement");
  }
  
  return false;
}

// Check if admin can manage application
export function canManageApplication(admin: AdminAuthPayload, application: any, project: any): boolean {
  if (admin.roles.includes("SUPER_ADMIN")) {
    return true;
  }
  
  // Must be able to access the project
  if (!canModerateProject(admin, project)) {
    return false;
  }
  
  // Additional checks for application management
  if (admin.roles.includes("DEPT_ADMIN")) {
    // DEPT_ADMIN can manage applications from their department
    return application.studentDepartment === admin.scope.department;
  }
  
  return true;
}
