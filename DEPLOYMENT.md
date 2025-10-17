# 🚀 Production Deployment Guide

## ✅ Pre-Deployment Checklist

### 1. Code Quality & Security
- [x] All TypeScript compilation errors resolved
- [x] Database connection string properly formatted
- [x] Environment variables validated
- [x] Security headers implemented
- [x] Rate limiting configured
- [x] Input validation in place
- [x] Error handling comprehensive
- [x] Logging structured and secure

### 2. Database & Infrastructure
- [x] Database schema auto-initialization
- [x] Connection pooling configured (20 connections)
- [x] Redis caching implemented (optional)
- [x] Health checks functional
- [x] Graceful shutdown handling
- [x] WebSocket real-time features

### 3. Container & Deployment
- [x] Multi-stage Dockerfile optimized
- [x] Non-root user security
- [x] Health check endpoint
- [x] Signal handling with dumb-init
- [x] Production environment variables
- [x] Startup database initialization

## 🔧 Fixed Issues

### Critical Fixes Applied:
1. **Database Connection**: Fixed URL parameter concatenation (`&` vs `?`)
2. **Module System**: Changed from ES modules to CommonJS for Node.js compatibility
3. **Logger Middleware**: Fixed `reply.addHook` error with proper onResponse hook
4. **Import Consistency**: Unified authentication middleware imports
5. **Database Initialization**: Added automatic schema deployment on startup
6. **TypeScript Configuration**: Proper CommonJS compilation settings

### Performance Optimizations:
- Connection pooling with 20 concurrent connections
- Redis caching with fallback to in-memory
- Database query optimization with proper indexing
- WebSocket room-based event targeting
- Structured logging with correlation IDs

### Security Enhancements:
- JWT token validation with JWKS
- Role-based access control (RBAC)
- Input sanitization and validation
- Security headers (CORS, CSP, etc.)
- Rate limiting per endpoint type
- Audit logging for admin actions

## 🌐 Deployment Options

### Option 1: Docker Standalone
```bash
# Build and run
docker build -t nexus-projects-service .
docker run -d --name nexus-projects -p 4003:4003 --env-file .env nexus-projects-service
```

### Option 2: Docker Compose
```yaml
version: '3.8'
services:
  projects-service:
    build: .
    ports:
      - "4003:4003"
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4003/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Option 3: Kubernetes
```bash
# Apply manifests (create k8s/ directory with deployment.yaml, service.yaml)
kubectl apply -f k8s/
kubectl get pods -l app=nexus-projects-service
```

### Option 4: Railway/Vercel
```bash
# Railway deployment
railway login
railway link
railway up

# Environment variables will be set via Railway dashboard
```

## 📊 Monitoring & Observability

### Health Endpoints
- **Basic Health**: `GET /health`
- **Detailed Health**: `GET /health/ready`
- **Database Health**: `GET /health/database`
- **Cache Health**: `GET /health/cache`
- **Metrics**: `GET /health/metrics` (requires internal API key)

### Logging
- Structured JSON logging in production
- Correlation IDs for request tracing
- Security event logging
- Performance monitoring
- Admin action audit trails

### Key Metrics to Monitor
- Response time (target: <200ms for 95th percentile)
- Error rate (target: <1%)
- Database connection pool usage
- WebSocket connection count
- Memory usage (target: <1GB RSS)
- CPU usage (target: <70%)

## 🔐 Security Configuration

### Required Environment Variables
```bash
# Authentication
AUTH_JWKS_URL=https://your-auth-service/.well-known/jwks.json
AUTH_JWT_ISSUER=nexus-auth
AUTH_JWT_AUDIENCE=nexus
AUTH_BASE_URL=https://your-auth-service

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db?schema=projectsvc

# Security
INTERNAL_API_KEY=your-secure-random-key-here

# Optional
REDIS_URL=redis://user:pass@host:6379/0
PROFILE_BASE_URL=https://your-profile-service
```

### Security Best Practices
1. Use strong, unique INTERNAL_API_KEY
2. Enable SSL/TLS for database connections
3. Use Redis AUTH if Redis is enabled
4. Implement network segmentation
5. Regular security updates
6. Monitor for suspicious activity

## 🚨 Troubleshooting

### Common Issues

#### Database Connection Errors
```bash
# Check database connectivity
docker exec -it nexus-projects node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$queryRaw\`SELECT 1\`.then(() => console.log('✅ DB OK')).catch(console.error);
"
```

#### WebSocket Issues
```bash
# Check WebSocket health
curl -H "x-internal-key: YOUR_KEY" http://localhost:4003/health/metrics
```

#### Memory Issues
```bash
# Monitor memory usage
docker stats nexus-projects
```

### Log Analysis
```bash
# View structured logs
docker logs nexus-projects | jq '.'

# Filter by component
docker logs nexus-projects | jq 'select(.component == "request")'

# Filter errors
docker logs nexus-projects | jq 'select(.level == "error")'
```

## 📈 Scaling Considerations

### Horizontal Scaling
- Stateless design allows multiple instances
- WebSocket events use Redis pub/sub for multi-instance
- Database connection pooling per instance
- Load balancer with sticky sessions for WebSocket

### Vertical Scaling
- Increase memory limit for larger datasets
- Adjust database connection pool size
- Tune Node.js heap size with NODE_OPTIONS

### Database Scaling
- Read replicas for query optimization
- Connection pooling with PgBouncer
- Database sharding for massive scale
- Regular VACUUM and ANALYZE operations

## 🎯 Success Criteria

### Deployment Success
- [x] Service starts without errors
- [x] Health check returns 200 OK
- [x] Database tables created automatically
- [x] API endpoints respond correctly
- [x] WebSocket connections work
- [x] Authentication validates properly

### Performance Targets
- Response time: <200ms (95th percentile)
- Throughput: >1000 requests/second
- Memory usage: <1GB RSS
- CPU usage: <70% average
- Error rate: <1%
- Uptime: >99.9%

## 📞 Support

### Emergency Contacts
- **DevOps Team**: devops@nexus.edu
- **Security Team**: security@nexus.edu
- **On-Call Engineer**: +1-XXX-XXX-XXXX

### Documentation
- **API Docs**: http://localhost:4003/docs
- **Architecture**: docs/architecture.md
- **Runbooks**: docs/runbooks/
- **Monitoring**: docs/monitoring.md

---

**Status**: ✅ PRODUCTION READY
**Last Updated**: 2025-01-17
**Version**: 1.0.0
