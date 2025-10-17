#!/usr/bin/env node

/**
 * Database initialization script for Projects Service
 * This script ensures the database is properly set up before starting the service
 */

const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

async function initializeDatabase() {
  console.log('🔄 Initializing Projects Service database...');
  
  try {
    // Step 1: Generate Prisma client (in case it's not generated)
    console.log('📦 Generating Prisma client...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    
    // Step 2: Push schema to database (creates tables if they don't exist)
    console.log('🗄️  Pushing schema to database...');
    execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
    
    // Step 3: Test database connection
    console.log('🔍 Testing database connection...');
    const prisma = new PrismaClient();
    
    // Test basic connectivity
    await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Database connection successful');
    
    // Test table existence by counting projects
    const projectCount = await prisma.project.count();
    console.log(`📊 Found ${projectCount} projects in database`);
    
    await prisma.$disconnect();
    console.log('✅ Database initialization completed successfully!');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    
    // If it's a connection error, provide helpful guidance
    if (error.message.includes('connect') || error.message.includes('timeout')) {
      console.error('💡 Possible solutions:');
      console.error('   - Check DATABASE_URL environment variable');
      console.error('   - Ensure database server is running and accessible');
      console.error('   - Verify network connectivity');
    }
    
    // If it's a schema error, provide guidance
    if (error.message.includes('table') || error.message.includes('schema')) {
      console.error('💡 Schema issues detected:');
      console.error('   - Database schema may be out of sync');
      console.error('   - Try running: npx prisma db push --force-reset');
    }
    
    process.exit(1);
  }
}

// Run initialization
initializeDatabase().catch((error) => {
  console.error('❌ Unexpected error during database initialization:', error);
  process.exit(1);
});
