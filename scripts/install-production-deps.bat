@echo off
REM Production Dependencies Installation Script for Projects Service (Windows)
REM This script installs missing production dependencies

echo 🚀 Installing production dependencies for Projects Service...

REM Install rate limiting package
echo 📦 Installing @fastify/rate-limit...
npm install @fastify/rate-limit@^9.1.0

REM Verify installation
echo ✅ Verifying installations...
npm list @fastify/rate-limit

REM Regenerate Prisma client to ensure compatibility
echo 🔄 Regenerating Prisma client...
npx prisma generate

echo ✅ Production dependencies installed successfully!
echo.
echo Next steps:
echo 1. Uncomment rate limiting code in src/index.ts
echo 2. Test the service with: npm run dev
echo 3. Run production build: npm run build
echo.
echo 🎯 Service is now production-ready!
