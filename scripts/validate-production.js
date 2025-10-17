#!/usr/bin/env node

/**
 * Production Readiness Validation Script for Projects Service
 * Validates all critical components before deployment
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating Projects Service for Production Deployment...\n');

let hasErrors = false;
let hasWarnings = false;

function error(message) {
  console.error(`❌ ERROR: ${message}`);
  hasErrors = true;
}

function warning(message) {
  console.warn(`⚠️  WARNING: ${message}`);
  hasWarnings = true;
}

function success(message) {
  console.log(`✅ ${message}`);
}

function info(message) {
  console.log(`ℹ️  ${message}`);
}

// 1. Check Environment Configuration
info('Checking environment configuration...');
const envExample = fs.readFileSync('.env.example', 'utf8');
const requiredEnvVars = [
  'NODE_ENV',
  'PORT', 
  'DATABASE_URL',
  'AUTH_JWKS_URL',
  'AUTH_JWT_ISSUER', 
  'AUTH_JWT_AUDIENCE',
  'AUTH_BASE_URL',
  'PROFILE_BASE_URL',
  'INTERNAL_API_KEY'
];

requiredEnvVars.forEach(varName => {
  if (envExample.includes(`${varName}=`)) {
    success(`Environment variable ${varName} documented in .env.example`);
  } else {
    error(`Missing ${varName} in .env.example`);
  }
});

// 2. Check Critical Files
info('\nChecking critical files...');
const criticalFiles = [
  'package.json',
  'Dockerfile',
  '.dockerignore',
  'tsconfig.json',
  'prisma/schema.prisma',
  'src/index.ts',
  'src/db.ts',
  'src/config/env.ts',
  'scripts/init-db.js'
];

criticalFiles.forEach(file => {
  if (fs.existsSync(file)) {
    success(`Critical file exists: ${file}`);
  } else {
    error(`Missing critical file: ${file}`);
  }
});

// 3. Check Package.json Configuration
info('\nChecking package.json configuration...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (packageJson.type === 'module') {
  error('package.json has "type": "module" which conflicts with CommonJS build');
} else {
  success('Package.json module type is correct for CommonJS');
}

if (packageJson.scripts.build) {
  success('Build script exists');
} else {
  error('Missing build script in package.json');
}

if (packageJson.scripts.start) {
  success('Start script exists');
} else {
  error('Missing start script in package.json');
}

// 4. Check TypeScript Configuration
info('\nChecking TypeScript configuration...');
const tsConfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));

if (tsConfig.compilerOptions.module === 'CommonJS') {
  success('TypeScript configured for CommonJS modules');
} else {
  error('TypeScript should use CommonJS modules for Node.js compatibility');
}

if (tsConfig.compilerOptions.outDir === 'dist') {
  success('TypeScript output directory is correct');
} else {
  warning('TypeScript output directory should be "dist"');
}

// 5. Check Prisma Schema
info('\nChecking Prisma schema...');
const prismaSchema = fs.readFileSync('prisma/schema.prisma', 'utf8');

if (prismaSchema.includes('generator client')) {
  success('Prisma client generator configured');
} else {
  error('Missing Prisma client generator');
}

if (prismaSchema.includes('datasource db')) {
  success('Prisma datasource configured');
} else {
  error('Missing Prisma datasource configuration');
}

// Count models
const modelCount = (prismaSchema.match(/^model /gm) || []).length;
if (modelCount >= 5) {
  success(`Prisma schema has ${modelCount} models`);
} else {
  warning(`Only ${modelCount} models found in schema`);
}

// 6. Check Dockerfile
info('\nChecking Dockerfile...');
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

if (dockerfile.includes('FROM node:20-alpine')) {
  success('Dockerfile uses Node.js 20 LTS Alpine');
} else {
  warning('Dockerfile should use Node.js 20 LTS Alpine for security and size');
}

if (dockerfile.includes('USER nexus')) {
  success('Dockerfile runs as non-root user');
} else {
  error('Dockerfile should run as non-root user for security');
}

if (dockerfile.includes('HEALTHCHECK')) {
  success('Dockerfile includes health check');
} else {
  warning('Dockerfile should include health check for container orchestration');
}

if (dockerfile.includes('dumb-init')) {
  success('Dockerfile uses dumb-init for proper signal handling');
} else {
  warning('Dockerfile should use dumb-init for proper signal handling');
}

// 7. Check Security Configuration
info('\nChecking security configuration...');
const envConfig = fs.readFileSync('src/config/env.ts', 'utf8');

if (envConfig.includes('validateEnv')) {
  success('Environment validation implemented');
} else {
  error('Missing environment validation');
}

if (envConfig.includes('INTERNAL_API_KEY')) {
  success('Internal API key configuration exists');
} else {
  error('Missing internal API key configuration');
}

// 8. Check Route Files
info('\nChecking route files...');
const routeFiles = [
  'src/routes/health.routes.ts',
  'src/routes/projects.routes.ts', 
  'src/routes/faculty.routes.ts',
  'src/routes/student.routes.ts',
  'src/routes/public.routes.ts',
  'src/routes/collaboration.routes.ts'
];

routeFiles.forEach(file => {
  if (fs.existsSync(file)) {
    success(`Route file exists: ${file}`);
    
    // Check for proper imports
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('from "../middlewares/unifiedAuth"') || content.includes('from "../middlewares/auth"')) {
      success(`${file} uses proper authentication`);
    } else if (content.includes('health.routes')) {
      success(`${file} is health route (no auth required)`);
    } else {
      warning(`${file} may be missing authentication middleware`);
    }
  } else {
    error(`Missing route file: ${file}`);
  }
});

// 9. Check Middleware Files
info('\nChecking middleware files...');
const middlewareFiles = [
  'src/middlewares/auth.ts',
  'src/middlewares/unifiedAuth.ts',
  'src/middlewares/errorHandler.ts',
  'src/middlewares/securityHeaders.ts',
  'src/middlewares/responseFormatter.ts'
];

middlewareFiles.forEach(file => {
  if (fs.existsSync(file)) {
    success(`Middleware exists: ${file}`);
  } else {
    error(`Missing middleware: ${file}`);
  }
});

// 10. Check Database Configuration
info('\nChecking database configuration...');
const dbConfig = fs.readFileSync('src/db.ts', 'utf8');

if (dbConfig.includes('connection_limit')) {
  success('Database connection pooling configured');
} else {
  warning('Database connection pooling should be configured for production');
}

if (dbConfig.includes('PrismaClient')) {
  success('Prisma client properly imported');
} else {
  error('Missing Prisma client import');
}

// 11. Final Summary
console.log('\n' + '='.repeat(60));
console.log('📋 PRODUCTION READINESS SUMMARY');
console.log('='.repeat(60));

if (hasErrors) {
  console.log('❌ DEPLOYMENT BLOCKED - Critical errors found');
  console.log('   Please fix all errors before deploying to production');
  process.exit(1);
} else if (hasWarnings) {
  console.log('⚠️  DEPLOYMENT READY WITH WARNINGS');
  console.log('   Service can be deployed but consider fixing warnings');
  console.log('   for optimal production performance and security');
} else {
  console.log('✅ PRODUCTION READY');
  console.log('   All checks passed - safe to deploy to production');
}

console.log('\n🚀 Next Steps:');
console.log('   1. Run: docker build -t nexus-projects-service .');
console.log('   2. Test: docker run --rm -p 4003:4003 --env-file .env nexus-projects-service');
console.log('   3. Deploy to your container orchestration platform');
console.log('   4. Set up monitoring and logging');
console.log('   5. Configure load balancing and auto-scaling');

console.log('\n📚 Documentation:');
console.log('   - API Documentation: http://localhost:4003/docs');
console.log('   - Health Check: http://localhost:4003/health');
console.log('   - Metrics: http://localhost:4003/health/metrics (requires internal API key)');
