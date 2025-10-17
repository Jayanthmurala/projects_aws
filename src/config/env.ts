import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function validateEnv() {
  // Only validate critical env vars in production
  if (env.NODE_ENV === 'production') {
    const required = ['DATABASE_URL', 'AUTH_JWKS_URL', 'AUTH_JWT_ISSUER', 'AUTH_JWT_AUDIENCE'];
    const missing: string[] = [];
    
    for (const key of required) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  } else {
    // In development, just warn about missing vars
    const recommended = ['DATABASE_URL', 'AUTH_JWKS_URL'];
    const missing = recommended.filter(key => !process.env[key]);
    if (missing.length > 0) {
      console.warn(`⚠️  Recommended environment variables missing: ${missing.join(', ')}`);
      console.warn('   Service will use defaults for development');
    }
  }

  // Validate URL formats (only in production)
  if (env.NODE_ENV === 'production') {
    try {
      new URL(env.AUTH_JWKS_URL);
    } catch {
      throw new Error('AUTH_JWKS_URL must be a valid URL');
    }

    if (env.PROFILE_BASE_URL) {
      try {
        new URL(env.PROFILE_BASE_URL);
      } catch {
        throw new Error('PROFILE_BASE_URL must be a valid URL');
      }
    }

    if (env.AUTH_BASE_URL) {
      try {
        new URL(env.AUTH_BASE_URL);
      } catch {
        throw new Error('AUTH_BASE_URL must be a valid URL');
      }
    }
  }

  // Validate port
  if (isNaN(env.PORT) || env.PORT < 1 || env.PORT > 65535) {
    throw new Error('PORT must be a valid port number (1-65535)');
  }

  // Warn about insecure defaults in production
  if (env.NODE_ENV === 'production') {
    if (env.INTERNAL_API_KEY === 'dev-internal-key-change-in-production') {
      throw new Error('INTERNAL_API_KEY must be changed in production');
    }
    
    if (!env.REDIS_URL) {
      console.warn('WARNING: REDIS_URL not set in production - using in-memory cache');
    }
  }
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 4003),
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/nexus_auth?schema=projectsvc",

  AUTH_JWKS_URL: process.env.AUTH_JWKS_URL ?? "http://localhost:4001/.well-known/jwks.json",
  AUTH_JWT_ISSUER: process.env.AUTH_JWT_ISSUER ?? "nexus-auth",
  AUTH_JWT_AUDIENCE: process.env.AUTH_JWT_AUDIENCE ?? "nexus",

  PROFILE_BASE_URL: process.env.PROFILE_BASE_URL ?? "https://profileaws-production.up.railway.app",
  AUTH_BASE_URL: process.env.AUTH_BASE_URL ?? "https://authaws-production.up.railway.app",
  REDIS_URL: process.env.REDIS_URL,
  FRONTEND_URL: process.env.FRONTEND_URL ?? "http://localhost:3000",
  
  // Security
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY ?? "dev-internal-key-change-in-production",
};

// Validate environment on module load
validateEnv();
