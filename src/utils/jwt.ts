import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { env } from "../config/env";

const JWKS = createRemoteJWKSet(new URL(env.AUTH_JWKS_URL));

export type AccessTokenPayload = JWTPayload & {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  displayName?: string;
  avatarUrl?: string;
  roles?: string[];
  tv?: number;
};

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    // Only log config in development mode
    if (env.NODE_ENV === 'development') {
      console.log('[JWT] Verifying token with config:', {
        issuer: env.AUTH_JWT_ISSUER,
        audience: env.AUTH_JWT_AUDIENCE,
        jwksUrl: env.AUTH_JWKS_URL
      });
    }
    
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.AUTH_JWT_ISSUER,
      audience: env.AUTH_JWT_AUDIENCE,
      algorithms: ['RS256', 'ES256'] // Restrict to secure algorithms only
    });
    
    // Only log token details in development mode, and mask sensitive data
    if (env.NODE_ENV === 'development') {
      console.log('[JWT] Token verified successfully:', {
        sub: payload.sub,
        email: typeof payload.email === 'string' ? `${payload.email.substring(0, 3)}***` : undefined,
        roles: payload.roles,
        iss: payload.iss,
        aud: payload.aud
      });
    }
    
    return payload as AccessTokenPayload;
  } catch (error) {
    // Log errors but don't expose sensitive token information
    console.error('[JWT] Token verification failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}
