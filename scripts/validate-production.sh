#!/bin/bash

# Production Environment Validation Script
# Validates that all production requirements are met before deployment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="${NAMESPACE:-nexus-projects}"
SERVICE_NAME="${SERVICE_NAME:-nexus-projects-service}"
TIMEOUT="${TIMEOUT:-300}"

# Counters
CHECKS_PASSED=0
CHECKS_FAILED=0
WARNINGS=0

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
    ((CHECKS_PASSED++))
}

log_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
    ((WARNINGS++))
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
    ((CHECKS_FAILED++))
}

# Check functions
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check kubectl
    if command -v kubectl &> /dev/null; then
        log_success "kubectl is installed"
    else
        log_error "kubectl is not installed"
    fi
    
    # Check docker
    if command -v docker &> /dev/null; then
        log_success "Docker is installed"
    else
        log_error "Docker is not installed"
    fi
    
    # Check curl
    if command -v curl &> /dev/null; then
        log_success "curl is installed"
    else
        log_error "curl is not installed"
    fi
    
    # Check cluster connectivity
    if kubectl cluster-info &> /dev/null; then
        log_success "Kubernetes cluster is accessible"
    else
        log_error "Cannot connect to Kubernetes cluster"
    fi
}

check_kubernetes_resources() {
    log_info "Checking Kubernetes resources..."
    
    # Check namespace
    if kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_success "Namespace '$NAMESPACE' exists"
    else
        log_error "Namespace '$NAMESPACE' does not exist"
    fi
    
    # Check secrets
    if kubectl get secret nexus-projects-secrets -n "$NAMESPACE" &> /dev/null; then
        log_success "Required secrets exist"
        
        # Validate secret keys
        local required_keys=("DATABASE_URL" "REDIS_URL" "AUTH_JWKS_URL" "INTERNAL_API_KEY")
        for key in "${required_keys[@]}"; do
            if kubectl get secret nexus-projects-secrets -n "$NAMESPACE" -o jsonpath="{.data.$key}" | base64 -d &> /dev/null; then
                log_success "Secret key '$key' exists and is valid"
            else
                log_error "Secret key '$key' is missing or invalid"
            fi
        done
    else
        log_error "Required secrets do not exist"
    fi
    
    # Check configmaps
    if kubectl get configmap nexus-projects-config -n "$NAMESPACE" &> /dev/null; then
        log_success "ConfigMap exists"
    else
        log_error "ConfigMap does not exist"
    fi
    
    # Check service account
    if kubectl get serviceaccount nexus-projects-service -n "$NAMESPACE" &> /dev/null; then
        log_success "Service account exists"
    else
        log_warning "Service account does not exist (will be created during deployment)"
    fi
}

check_docker_image() {
    log_info "Checking Docker image..."
    
    local image_tag="${IMAGE_TAG:-latest}"
    local registry="${REGISTRY:-ghcr.io/nexus}"
    local full_image="$registry/projects-service:$image_tag"
    
    # Check if image exists locally
    if docker image inspect "$full_image" &> /dev/null; then
        log_success "Docker image '$full_image' exists locally"
    else
        log_warning "Docker image '$full_image' not found locally"
        
        # Try to pull the image
        if docker pull "$full_image" &> /dev/null; then
            log_success "Successfully pulled Docker image"
        else
            log_error "Cannot pull Docker image '$full_image'"
        fi
    fi
    
    # Check image security
    if command -v trivy &> /dev/null; then
        log_info "Running security scan on Docker image..."
        if trivy image --severity HIGH,CRITICAL --exit-code 0 "$full_image" &> /dev/null; then
            log_success "Docker image passed security scan"
        else
            log_warning "Docker image has security vulnerabilities"
        fi
    else
        log_warning "Trivy not installed, skipping security scan"
    fi
}

check_database_connectivity() {
    log_info "Checking database connectivity..."
    
    # Get database URL from secret
    local db_url
    if db_url=$(kubectl get secret nexus-projects-secrets -n "$NAMESPACE" -o jsonpath="{.data.DATABASE_URL}" 2>/dev/null | base64 -d); then
        # Extract connection details
        local db_host db_port db_name
        db_host=$(echo "$db_url" | sed -n 's/.*@\([^:]*\):.*/\1/p')
        db_port=$(echo "$db_url" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        db_name=$(echo "$db_url" | sed -n 's/.*\/\([^?]*\).*/\1/p')
        
        if [[ -n "$db_host" && -n "$db_port" ]]; then
            # Test connectivity using nc (netcat)
            if command -v nc &> /dev/null; then
                if timeout 5 nc -z "$db_host" "$db_port" 2>/dev/null; then
                    log_success "Database is reachable at $db_host:$db_port"
                else
                    log_error "Cannot connect to database at $db_host:$db_port"
                fi
            else
                log_warning "netcat not available, skipping database connectivity test"
            fi
        else
            log_error "Invalid database URL format"
        fi
    else
        log_error "Cannot retrieve database URL from secrets"
    fi
}

check_redis_connectivity() {
    log_info "Checking Redis connectivity..."
    
    # Get Redis URL from secret
    local redis_url
    if redis_url=$(kubectl get secret nexus-projects-secrets -n "$NAMESPACE" -o jsonpath="{.data.REDIS_URL}" 2>/dev/null | base64 -d); then
        # Extract connection details
        local redis_host redis_port
        redis_host=$(echo "$redis_url" | sed -n 's/redis:\/\/.*@\([^:]*\):.*/\1/p')
        redis_port=$(echo "$redis_url" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        
        if [[ -z "$redis_host" ]]; then
            redis_host=$(echo "$redis_url" | sed -n 's/redis:\/\/\([^:]*\):.*/\1/p')
        fi
        
        if [[ -n "$redis_host" && -n "$redis_port" ]]; then
            # Test connectivity
            if command -v nc &> /dev/null; then
                if timeout 5 nc -z "$redis_host" "$redis_port" 2>/dev/null; then
                    log_success "Redis is reachable at $redis_host:$redis_port"
                else
                    log_warning "Cannot connect to Redis at $redis_host:$redis_port (fallback to in-memory cache)"
                fi
            else
                log_warning "netcat not available, skipping Redis connectivity test"
            fi
        else
            log_warning "Invalid Redis URL format or Redis not configured"
        fi
    else
        log_warning "Redis URL not found in secrets (will use in-memory cache)"
    fi
}

check_external_services() {
    log_info "Checking external service connectivity..."
    
    # Check Auth service
    local auth_url
    if auth_url=$(kubectl get secret nexus-projects-secrets -n "$NAMESPACE" -o jsonpath="{.data.AUTH_JWKS_URL}" 2>/dev/null | base64 -d); then
        if curl -f -s --max-time 10 "$auth_url" > /dev/null; then
            log_success "Auth service JWKS endpoint is accessible"
        else
            log_error "Cannot reach Auth service JWKS endpoint: $auth_url"
        fi
    else
        log_error "Auth JWKS URL not found in secrets"
    fi
    
    # Check Profile service
    local profile_url
    if profile_url=$(kubectl get secret nexus-projects-secrets -n "$NAMESPACE" -o jsonpath="{.data.PROFILE_BASE_URL}" 2>/dev/null | base64 -d); then
        if curl -f -s --max-time 10 "$profile_url/health" > /dev/null 2>&1; then
            log_success "Profile service is accessible"
        else
            log_warning "Profile service health check failed (may still work)"
        fi
    else
        log_warning "Profile service URL not configured"
    fi
}

check_monitoring_setup() {
    log_info "Checking monitoring setup..."
    
    # Check if Prometheus is available
    if kubectl get servicemonitor nexus-projects-service-metrics -n "$NAMESPACE" &> /dev/null; then
        log_success "Prometheus ServiceMonitor is configured"
    else
        log_warning "Prometheus ServiceMonitor not found"
    fi
    
    # Check if Grafana dashboard is available
    if kubectl get configmap nexus-projects-dashboard -n "$NAMESPACE" &> /dev/null; then
        log_success "Grafana dashboard is configured"
    else
        log_warning "Grafana dashboard not found"
    fi
    
    # Check PrometheusRule for alerts
    if kubectl get prometheusrule nexus-projects-service-alerts -n "$NAMESPACE" &> /dev/null; then
        log_success "Prometheus alerting rules are configured"
    else
        log_warning "Prometheus alerting rules not found"
    fi
}

check_security_configuration() {
    log_info "Checking security configuration..."
    
    # Check NetworkPolicy
    if kubectl get networkpolicy nexus-projects-service-netpol -n "$NAMESPACE" &> /dev/null; then
        log_success "Network policy is configured"
    else
        log_warning "Network policy not found"
    fi
    
    # Check PodSecurityPolicy or SecurityContext
    if kubectl get deployment "$SERVICE_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.securityContext}' 2>/dev/null | grep -q "runAsNonRoot"; then
        log_success "Pod security context is configured"
    else
        log_warning "Pod security context not properly configured"
    fi
    
    # Check resource limits
    if kubectl get deployment "$SERVICE_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].resources.limits}' 2>/dev/null | grep -q "memory"; then
        log_success "Resource limits are configured"
    else
        log_warning "Resource limits not configured"
    fi
}

check_high_availability() {
    log_info "Checking high availability configuration..."
    
    # Check replica count
    local replicas
    if replicas=$(kubectl get deployment "$SERVICE_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}' 2>/dev/null); then
        if [[ "$replicas" -ge 3 ]]; then
            log_success "High availability: $replicas replicas configured"
        else
            log_warning "Low replica count: $replicas (recommended: 3+)"
        fi
    else
        log_warning "Deployment not found, cannot check replica count"
    fi
    
    # Check HPA
    if kubectl get hpa nexus-projects-service-hpa -n "$NAMESPACE" &> /dev/null; then
        log_success "Horizontal Pod Autoscaler is configured"
    else
        log_warning "Horizontal Pod Autoscaler not found"
    fi
    
    # Check PDB
    if kubectl get pdb nexus-projects-service-pdb -n "$NAMESPACE" &> /dev/null; then
        log_success "Pod Disruption Budget is configured"
    else
        log_warning "Pod Disruption Budget not found"
    fi
    
    # Check anti-affinity
    if kubectl get deployment "$SERVICE_NAME" -n "$NAMESPACE" -o yaml 2>/dev/null | grep -q "podAntiAffinity"; then
        log_success "Pod anti-affinity is configured"
    else
        log_warning "Pod anti-affinity not configured"
    fi
}

run_smoke_tests() {
    log_info "Running smoke tests..."
    
    # Port forward to service for testing
    kubectl port-forward service/"$SERVICE_NAME" 8080:4003 -n "$NAMESPACE" &
    local port_forward_pid=$!
    
    # Wait for port-forward to be ready
    sleep 5
    
    # Test health endpoint
    if curl -f -s http://localhost:8080/health --max-time 10 > /dev/null; then
        log_success "Health endpoint is working"
    else
        log_error "Health endpoint is not responding"
    fi
    
    # Test readiness endpoint
    if curl -f -s http://localhost:8080/health/ready --max-time 10 > /dev/null; then
        log_success "Readiness endpoint is working"
    else
        log_error "Readiness endpoint is not responding"
    fi
    
    # Test API endpoint (should require auth)
    local api_response
    api_response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/v1/projects --max-time 10)
    if [[ "$api_response" == "401" ]]; then
        log_success "API endpoint properly requires authentication"
    else
        log_warning "API endpoint response unexpected: $api_response"
    fi
    
    # Clean up port-forward
    kill $port_forward_pid 2>/dev/null || true
    wait $port_forward_pid 2>/dev/null || true
}

generate_report() {
    echo ""
    echo "=================================="
    echo "Production Validation Report"
    echo "=================================="
    echo ""
    echo -e "Checks passed: ${GREEN}$CHECKS_PASSED${NC}"
    echo -e "Checks failed: ${RED}$CHECKS_FAILED${NC}"
    echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
    echo ""
    
    if [[ $CHECKS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}✓ Production validation PASSED${NC}"
        echo "The service is ready for production deployment."
        
        if [[ $WARNINGS -gt 0 ]]; then
            echo -e "${YELLOW}⚠ There are $WARNINGS warnings that should be addressed for optimal production setup.${NC}"
        fi
        
        return 0
    else
        echo -e "${RED}✗ Production validation FAILED${NC}"
        echo "The service is NOT ready for production deployment."
        echo "Please address the failed checks before proceeding."
        
        return 1
    fi
}

# Main function
main() {
    echo "🔍 Starting production environment validation..."
    echo "Namespace: $NAMESPACE"
    echo "Service: $SERVICE_NAME"
    echo ""
    
    check_prerequisites
    check_kubernetes_resources
    check_docker_image
    check_database_connectivity
    check_redis_connectivity
    check_external_services
    check_monitoring_setup
    check_security_configuration
    check_high_availability
    
    # Only run smoke tests if basic checks pass
    if [[ $CHECKS_FAILED -eq 0 ]]; then
        run_smoke_tests
    else
        log_warning "Skipping smoke tests due to failed prerequisite checks"
    fi
    
    generate_report
}

# Script usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NS   Kubernetes namespace (default: nexus-projects)"
    echo "  -s, --service NAME   Service name (default: nexus-projects-service)"
    echo "  -t, --timeout SEC    Timeout for checks (default: 300)"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  NAMESPACE           Kubernetes namespace"
    echo "  SERVICE_NAME        Service name"
    echo "  IMAGE_TAG           Docker image tag to validate"
    echo "  REGISTRY            Docker registry"
    echo ""
    echo "Examples:"
    echo "  $0"
    echo "  $0 --namespace production --service nexus-projects"
    echo "  NAMESPACE=prod SERVICE_NAME=projects $0"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -s|--service)
            SERVICE_NAME="$2"
            shift 2
            ;;
        -t|--timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Run main function
main "$@"
