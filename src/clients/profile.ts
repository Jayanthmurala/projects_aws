import { env } from "../config/env";
import type { AccessTokenPayload } from "../utils/jwt";
import { getUserScopeFromJWT, getUserIdentity } from "./auth";
import { getCache, CACHE_KEYS, CACHE_TTL } from "../utils/cache";

// Cache instance
const cache = getCache();

export interface UserScope {
  collegeId?: string;
  department?: string;
  avatar?: string;
  displayName?: string;
  year?: number;
}

export async function getUserScope(req: any, payload: AccessTokenPayload): Promise<UserScope> {
  const cacheKey = CACHE_KEYS.USER_SCOPE(payload.sub);
  
  // Check Redis/cache first
  const cached = await getCachedScope(cacheKey);
  if (cached) return cached;

  // Try JWT-first approach (new tokens with profile object)
  const jwtScope = getUserScopeFromJWT(payload);
  
  // If we have displayName from JWT but missing collegeId/department, try external services
  if (jwtScope.displayName && (!jwtScope.collegeId || !jwtScope.department)) {
    // Continue to external service lookup instead of returning incomplete scope
  } else if (jwtScope.displayName && jwtScope.collegeId) {
    const scope = {
      collegeId: jwtScope.collegeId,
      department: jwtScope.department,
      year: jwtScope.year,
      displayName: jwtScope.displayName,
      avatar: (payload as any).avatarUrl || (payload as any).picture,
    };
    await setCachedScope(cacheKey, scope);
    return scope;
  }

  // Fallback to profile service for backward compatibility
  const auth = req.headers["authorization"] as string | undefined;
  if (!auth) throw new Error("Missing Authorization header for profile lookup");

  try {
    // Try auth service first for identity data
    const identity = await getUserIdentity(payload.sub, auth);
    const scope = {
      collegeId: identity.collegeId,
      department: identity.department,
      year: identity.year,
      displayName: identity.displayName,
      avatar: identity.avatarUrl,
    };
    await setCachedScope(cacheKey, scope);
    return scope;
  } catch (authError) {
    console.warn("Auth service fallback failed, trying profile service:", authError);
    
    try {
      // Final fallback to profile service
      const res = await fetch(`${env.PROFILE_BASE_URL}/v1/profile/me`, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      
      if (!res.ok) {
        throw new Error(`Profile service responded ${res.status}`);
      }
      
      const data = await res.json();
      const profile = data?.profile as { collegeId?: string; department?: string; avatar?: string } | null;
      
      // Return whatever profile data is available, even if incomplete
      const scope = {
        collegeId: profile?.collegeId,
        department: profile?.department,
        avatar: profile?.avatar,
        displayName: payload.name ?? (payload as any).displayName,
      };
      await setCachedScope(cacheKey, scope);
      return scope;
      
    } catch (profileError) {
      console.warn("Profile service also failed, using minimal JWT data:", profileError);
      
      // Ultimate fallback - use whatever we have from JWT
      const minimalScope = {
        displayName: payload.name ?? (payload as any).displayName ?? 'Unknown User',
        collegeId: jwtScope.collegeId, // May be undefined, that's okay
        department: jwtScope.department, // May be undefined, that's okay
      };
      
      // Cache the minimal scope to avoid repeated failures
      await setCachedScope(cacheKey, minimalScope);
      return minimalScope;
    }
  }
}

async function getCachedScope(cacheKey: string) {
  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.warn("Cache get error:", error);
  }
  return null;
}

async function setCachedScope(cacheKey: string, scope: any) {
  try {
    await cache.set(cacheKey, JSON.stringify(scope), CACHE_TTL.USER_SCOPE);
  } catch (error) {
    console.warn("Cache set error:", error);
  }
}
