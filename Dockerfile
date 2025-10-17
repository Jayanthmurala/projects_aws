# =============================================================================
# Nexus Projects Service - Production Dockerfile
# Multi-stage build optimized for 10M+ users with Node.js 20 LTS
# Supports WebSocket, Redis caching, PostgreSQL, and microservice architecture
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder - Install dependencies and build application
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

# Install build dependencies for native modules (prisma, socket.io, redis, pg, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat \
    openssl-dev \
    openssl \
    libssl3 \
    && ln -sf python3 /usr/bin/python

# Set working directory
WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy source code and configuration files
COPY . .

# Generate Prisma client (must be done before TypeScript compilation)
# This ensures the client is generated inside Docker, not from local machine
RUN npx prisma generate --schema=./prisma/schema.prisma

# Build TypeScript to JavaScript with ES2020 modules
RUN npm run build

# Verify critical files exist - fail build early if missing
RUN test -f dist/index.js || (echo "ERROR: dist/index.js missing after build" && exit 1)
RUN test -f dist/db.js || (echo "ERROR: dist/db.js missing after build" && exit 1)
RUN test -d dist/routes || (echo "ERROR: dist/routes directory missing after build" && exit 1)
RUN test -d dist/config || (echo "ERROR: dist/config directory missing after build" && exit 1)
RUN test -d dist/middlewares || (echo "ERROR: dist/middlewares directory missing after build" && exit 1)
RUN test -d dist/utils || (echo "ERROR: dist/utils directory missing after build" && exit 1)
RUN test -d dist/clients || (echo "ERROR: dist/clients directory missing after build" && exit 1)
RUN test -d dist/admin || (echo "ERROR: dist/admin directory missing after build" && exit 1)

# List built files for debugging
RUN echo "=== Build Verification ===" && \
    ls -la dist/ && \
    echo "=== Routes ===" && \
    ls -la dist/routes/ && \
    echo "=== Config ===" && \
    ls -la dist/config/ && \
    echo "=== Middlewares ===" && \
    ls -la dist/middlewares/ && \
    echo "=== Utils ===" && \
    ls -la dist/utils/ && \
    echo "=== Clients ===" && \
    ls -la dist/clients/ && \
    echo "=== Admin ===" && \
    ls -la dist/admin/

# -----------------------------------------------------------------------------
# Stage 2: Production Runtime - Minimal image with only runtime dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Install runtime dependencies and security updates
RUN apk update && apk upgrade && \
    apk add --no-cache \
        dumb-init \
        curl \
        ca-certificates \
        openssl \
        libssl3 \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nexus -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy package files for production dependency installation
COPY package*.json ./

# Copy Prisma schema BEFORE generating client
COPY --from=builder /app/prisma ./prisma

# Install only production dependencies and ensure Prisma client is generated
RUN npm install --omit=dev && \
    npx prisma generate --schema=./prisma/schema.prisma && \
    npm cache clean --force

# Copy built application and necessary files from builder stage
COPY --from=builder --chown=nexus:nodejs /app/dist ./dist
COPY --from=builder --chown=nexus:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nexus:nodejs /app/scripts ./scripts

# Create startup script that initializes database and starts the application
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'echo "Starting Nexus Projects Service..."' >> /app/start.sh && \
    echo 'node scripts/init-db.js' >> /app/start.sh && \
    echo 'echo "Starting main application..."' >> /app/start.sh && \
    echo 'exec node dist/index.js' >> /app/start.sh && \
    chmod +x /app/start.sh

# Ensure all files are owned by nexus user
RUN chown -R nexus:nodejs /app

# Switch to non-root user
USER nexus

# Set production environment variables
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1536"

# Expose application port (from .env.example)
EXPOSE 4003

# Health check for container orchestration
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:4003/health || exit 1

# Use dumb-init for proper signal handling and process management
ENTRYPOINT ["dumb-init", "--"]

# Start the application with database initialization
CMD ["/app/start.sh"]

# Metadata labels
LABEL maintainer="Nexus Development Team"
LABEL version="0.1.0"
LABEL description="Nexus Projects Service - Production Ready for 10M+ Users with WebSocket & Real-time Collaboration"
LABEL org.opencontainers.image.title="nexus-projects-service"
LABEL org.opencontainers.image.description="Enterprise project management service with WebSocket, Redis clustering, PostgreSQL, and JWT authentication"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.source="https://github.com/nexus/projects-service"
