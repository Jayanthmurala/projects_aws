import { FastifyRequest } from "fastify";
import { verifyAccessToken } from "../utils/jwt";
import { getUserScopeFromJWT, getUserIdentity } from "../clients/auth";
import { getCache, CACHE_KEYS, CACHE_TTL } from "../utils/cache";

// Unified auth payload interface
export interface UnifiedAuthPayload {
  sub: string;
  name?: string;
  email?: string;
  roles: string[];
  displayName?: string;
  scope: {
    collegeId?: string;
    department?: string;
    year?: number;
    displayName?: string;
    avatar?: string;
    collegeMemberId?: string;
  };
}

// Cache instance
const cache = getCache();

/**
 * Unified authentication function that replaces both requireAuth and requireUser
 * Provides consistent error handling and caching
 */
export async function authenticateUser(req: FastifyRequest): Promise<UnifiedAuthPayload> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    throw createAuthError(401, 'Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);
  
  try {
    // Verify JWT token
    const payload = await verifyAccessToken(token);
    
    // Get user scope from JWT (preferred method)
    const jwtScope = getUserScopeFromJWT(payload);
    
    let authPayload: UnifiedAuthPayload = {
      sub: payload.sub,
      name: payload.name,
      email: payload.email,
      roles: payload.roles || [],
      displayName: jwtScope.displayName || payload.displayName,
      scope: {
        collegeId: jwtScope.collegeId,
        department: jwtScope.department,
        year: jwtScope.year,
        displayName: jwtScope.displayName,
        avatar: jwtScope.avatar
      }
    };
    
    // If critical scope data is missing, fetch from auth service with caching
    if (!authPayload.scope.collegeId || !authPayload.scope.department) {
      try {
        const cachedIdentity = await getCachedUserIdentity(payload.sub);
        if (cachedIdentity) {
          // Use cached data
          authPayload.scope.collegeId = cachedIdentity.collegeId;
          authPayload.scope.department = cachedIdentity.department;
          authPayload.scope.collegeMemberId = cachedIdentity.collegeMemberId;
          authPayload.displayName = cachedIdentity.displayName;
          authPayload.scope.avatar = cachedIdentity.avatarUrl;
        } else {
          // Fetch from auth service and cache
          const userIdentity = await getUserIdentity(payload.sub, authHeader);
          authPayload.scope.collegeId = userIdentity.collegeId;
          authPayload.scope.department = userIdentity.department;
          authPayload.scope.collegeMemberId = userIdentity.collegeMemberId;
          authPayload.displayName = userIdentity.displayName;
          authPayload.scope.avatar = userIdentity.avatarUrl;
          
          // Cache for future requests
          await setCachedUserIdentity(payload.sub, userIdentity);
        }
      } catch (error) {
        // Log error but don't fail authentication if JWT has basic info
        console.warn(`Failed to fetch user identity for ${payload.sub}:`, error);
      }
    }
    
    return authPayload;
  } catch (error: any) {
    // Handle specific JWT errors
    if (error?.name === 'JWTExpired' || error?.code === 'ERR_JWT_EXPIRED') {
      throw createAuthError(401, 'Token expired', 'TOKEN_EXPIRED');
    }
    
    if (error?.name === 'JWTInvalid' || error?.message?.includes('Invalid')) {
      throw createAuthError(401, 'Invalid token', 'TOKEN_INVALID');
    }
    
    // Re-throw auth errors as-is
    if (error.statusCode) {
      throw error;
    }
    
    // Generic auth failure
    throw createAuthError(401, 'Authentication failed', 'AUTH_FAILED');
  }
}

/**
 * Optional authentication - returns null if no valid token
 */
export async function optionalAuth(req: FastifyRequest): Promise<UnifiedAuthPayload | null> {
  try {
    return await authenticateUser(req);
  } catch (error) {
    // Return null for any authentication failure in optional mode
    return null;
  }
}

/**
 * Role-based authentication middleware
 */
export async function requireRole(req: FastifyRequest, allowedRoles: string[]): Promise<UnifiedAuthPayload> {
  const user = await authenticateUser(req);
  
  if (!user.roles.some(role => allowedRoles.includes(role))) {
    throw createAuthError(403, `Access denied. Required roles: ${allowedRoles.join(', ')}`, 'INSUFFICIENT_ROLES');
  }
  
  return user;
}

/**
 * Faculty-specific authentication
 */
export async function requireFaculty(req: FastifyRequest): Promise<UnifiedAuthPayload> {
  const user = await requireRole(req, ['FACULTY']);
  
  if (!user.scope.collegeId) {
    throw createAuthError(403, 'Faculty must be associated with a college', 'MISSING_COLLEGE');
  }
  
  return user;
}

/**
 * Student-specific authentication
 */
export async function requireStudent(req: FastifyRequest): Promise<UnifiedAuthPayload> {
  const user = await requireRole(req, ['STUDENT']);
  
  if (!user.scope.collegeId || !user.scope.department) {
    throw createAuthError(403, 'Student must be associated with a college and department', 'MISSING_SCOPE');
  }
  
  return user;
}

/**
 * Faculty or Student authentication
 */
export async function requireFacultyOrStudent(req: FastifyRequest): Promise<UnifiedAuthPayload> {
  const user = await requireRole(req, ['FACULTY', 'STUDENT']);
  
  if (!user.scope.collegeId) {
    throw createAuthError(403, 'Must be associated with a college', 'MISSING_COLLEGE');
  }
  
  return user;
}

/**
 * Admin authentication (HEAD_ADMIN, DEPT_ADMIN, etc.)
 */
export async function requireAdmin(req: FastifyRequest, adminRoles?: string[]): Promise<UnifiedAuthPayload> {
  const defaultAdminRoles = ['HEAD_ADMIN', 'DEPT_ADMIN', 'PLACEMENTS_ADMIN', 'SUPER_ADMIN'];
  const allowedRoles = adminRoles || defaultAdminRoles;
  
  const user = await requireRole(req, allowedRoles);
  
  // SUPER_ADMIN can access everything
  if (user.roles.includes('SUPER_ADMIN')) {
    return user;
  }
  
  // Other admins must be associated with a college
  if (!user.scope.collegeId) {
    throw createAuthError(403, 'Admin must be associated with a college', 'MISSING_COLLEGE');
  }
  
  return user;
}

// Helper functions for caching
async function getCachedUserIdentity(userId: string) {
  try {
    const cached = await cache.get(CACHE_KEYS.USER_IDENTITY(userId));
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.warn('Cache get error:', error);
    return null;
  }
}

async function setCachedUserIdentity(userId: string, identity: any) {
  try {
    await cache.set(CACHE_KEYS.USER_IDENTITY(userId), JSON.stringify(identity), CACHE_TTL.USER_IDENTITY);
  } catch (error) {
    console.warn('Cache set error:', error);
  }
}

// Helper function to create consistent auth errors
function createAuthError(statusCode: number, message: string, code?: string) {
  const error = new Error(message) as any;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

// Project access control helper
export function canAccessProject(user: UnifiedAuthPayload, project: any): boolean {
  // Super admin can access everything
  if (user.roles.includes("SUPER_ADMIN")) {
    return true;
  }

  // Check college scope
  if (user.scope.collegeId && project.collegeId !== user.scope.collegeId) {
    return false;
  }

  // Faculty can access their own projects and projects in their college
  if (user.roles.includes("FACULTY")) {
    return project.authorId === user.sub || project.collegeId === user.scope.collegeId;
  }

  // Students can access projects in their college/department
  if (user.roles.includes("STUDENT")) {
    if (project.visibleToAllDepts) {
      return project.collegeId === user.scope.collegeId;
    }
    return project.collegeId === user.scope.collegeId && 
           project.departments?.includes(user.scope.department);
  }

  return false;
}
