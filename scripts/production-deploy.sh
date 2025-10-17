#!/bin/bash

# Production Deployment Script for Nexus Projects Service
# This script handles the complete production deployment process

set -euo pipefail

# Configuration
NAMESPACE="nexus-projects"
SERVICE_NAME="nexus-projects-service"
IMAGE_TAG="${IMAGE_TAG:-latest}"
REGISTRY="${REGISTRY:-ghcr.io/nexus}"
TIMEOUT="${TIMEOUT:-600}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if kubectl is installed and configured
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Check if we can connect to the cluster
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    # Check if namespace exists
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_warning "Namespace $NAMESPACE does not exist, creating it..."
        kubectl apply -f k8s/namespace.yaml
    fi
    
    log_success "Prerequisites check passed"
}

# Validate Kubernetes manifests
validate_manifests() {
    log_info "Validating Kubernetes manifests..."
    
    local manifests=("k8s/namespace.yaml" "k8s/configmap.yaml" "k8s/secret.yaml" "k8s/deployment.yaml" "k8s/service.yaml" "k8s/ingress.yaml")
    
    for manifest in "${manifests[@]}"; do
        if [[ ! -f "$manifest" ]]; then
            log_error "Manifest file $manifest not found"
            exit 1
        fi
        
        # Validate YAML syntax
        if ! kubectl apply --dry-run=client -f "$manifest" &> /dev/null; then
            log_error "Invalid YAML in $manifest"
            exit 1
        fi
    done
    
    log_success "Manifest validation passed"
}

# Update image tag in deployment
update_image_tag() {
    log_info "Updating image tag to $IMAGE_TAG..."
    
    # Create a temporary deployment file with updated image
    cp k8s/deployment.yaml k8s/deployment-temp.yaml
    sed -i "s|image: nexus/projects-service:.*|image: $REGISTRY/projects-service:$IMAGE_TAG|g" k8s/deployment-temp.yaml
    
    log_success "Image tag updated"
}

# Deploy secrets (with validation)
deploy_secrets() {
    log_info "Deploying secrets..."
    
    # Check if secrets are properly configured
    if kubectl get secret nexus-projects-secrets -n "$NAMESPACE" &> /dev/null; then
        log_info "Secrets already exist, updating..."
    else
        log_warning "Secrets do not exist, creating from template..."
        log_warning "Please ensure all secret values are properly configured!"
    fi
    
    kubectl apply -f k8s/secret.yaml
    log_success "Secrets deployed"
}

# Deploy application
deploy_application() {
    log_info "Deploying application..."
    
    # Apply manifests in order
    kubectl apply -f k8s/configmap.yaml
    kubectl apply -f k8s/deployment-temp.yaml
    kubectl apply -f k8s/service.yaml
    kubectl apply -f k8s/ingress.yaml
    
    log_success "Application manifests applied"
}

# Deploy monitoring
deploy_monitoring() {
    log_info "Deploying monitoring configuration..."
    
    if [[ -f "k8s/monitoring.yaml" ]]; then
        kubectl apply -f k8s/monitoring.yaml
        log_success "Monitoring configuration deployed"
    else
        log_warning "Monitoring configuration not found, skipping..."
    fi
}

# Wait for deployment to be ready
wait_for_deployment() {
    log_info "Waiting for deployment to be ready (timeout: ${TIMEOUT}s)..."
    
    if kubectl rollout status deployment/"$SERVICE_NAME" -n "$NAMESPACE" --timeout="${TIMEOUT}s"; then
        log_success "Deployment is ready"
    else
        log_error "Deployment failed or timed out"
        
        # Show pod status for debugging
        log_info "Pod status:"
        kubectl get pods -n "$NAMESPACE" -l app="$SERVICE_NAME"
        
        # Show recent events
        log_info "Recent events:"
        kubectl get events -n "$NAMESPACE" --sort-by='.lastTimestamp' | tail -10
        
        exit 1
    fi
}

# Run health checks
run_health_checks() {
    log_info "Running health checks..."
    
    # Get service endpoint
    local service_ip
    service_ip=$(kubectl get service "$SERVICE_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}')
    
    if [[ -z "$service_ip" ]]; then
        log_error "Could not get service IP"
        exit 1
    fi
    
    # Wait a bit for the service to be fully ready
    sleep 30
    
    # Run health check using kubectl port-forward
    log_info "Testing health endpoint..."
    kubectl port-forward service/"$SERVICE_NAME" 8080:4003 -n "$NAMESPACE" &
    local port_forward_pid=$!
    
    # Wait for port-forward to be ready
    sleep 5
    
    # Test health endpoint
    if curl -f http://localhost:8080/health --max-time 10; then
        log_success "Health check passed"
    else
        log_error "Health check failed"
        kill $port_forward_pid 2>/dev/null || true
        exit 1
    fi
    
    # Test readiness endpoint
    if curl -f http://localhost:8080/health/ready --max-time 10; then
        log_success "Readiness check passed"
    else
        log_error "Readiness check failed"
        kill $port_forward_pid 2>/dev/null || true
        exit 1
    fi
    
    # Clean up port-forward
    kill $port_forward_pid 2>/dev/null || true
    
    log_success "All health checks passed"
}

# Cleanup temporary files
cleanup() {
    log_info "Cleaning up temporary files..."
    rm -f k8s/deployment-temp.yaml
    log_success "Cleanup completed"
}

# Rollback function
rollback() {
    log_error "Deployment failed, initiating rollback..."
    
    if kubectl rollout undo deployment/"$SERVICE_NAME" -n "$NAMESPACE"; then
        log_success "Rollback initiated"
        
        # Wait for rollback to complete
        if kubectl rollout status deployment/"$SERVICE_NAME" -n "$NAMESPACE" --timeout=300s; then
            log_success "Rollback completed successfully"
        else
            log_error "Rollback failed"
        fi
    else
        log_error "Could not initiate rollback"
    fi
}

# Main deployment function
main() {
    log_info "Starting production deployment of Nexus Projects Service..."
    log_info "Image: $REGISTRY/projects-service:$IMAGE_TAG"
    log_info "Namespace: $NAMESPACE"
    
    # Set trap for cleanup and rollback on error
    trap 'cleanup; rollback' ERR
    trap 'cleanup' EXIT
    
    check_prerequisites
    validate_manifests
    update_image_tag
    deploy_secrets
    deploy_application
    deploy_monitoring
    wait_for_deployment
    run_health_checks
    
    log_success "🚀 Production deployment completed successfully!"
    log_info "Service is now available at the configured ingress endpoints"
    
    # Show deployment info
    log_info "Deployment information:"
    kubectl get deployment "$SERVICE_NAME" -n "$NAMESPACE"
    kubectl get pods -n "$NAMESPACE" -l app="$SERVICE_NAME"
    kubectl get service "$SERVICE_NAME" -n "$NAMESPACE"
}

# Script usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -t, --tag TAG        Docker image tag (default: latest)"
    echo "  -r, --registry REG   Docker registry (default: ghcr.io/nexus)"
    echo "  -n, --namespace NS   Kubernetes namespace (default: nexus-projects)"
    echo "  -T, --timeout SEC    Deployment timeout in seconds (default: 600)"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  IMAGE_TAG           Docker image tag"
    echo "  REGISTRY            Docker registry"
    echo "  TIMEOUT             Deployment timeout"
    echo ""
    echo "Examples:"
    echo "  $0 --tag v1.2.3"
    echo "  $0 --registry myregistry.com --tag latest"
    echo "  IMAGE_TAG=v1.2.3 $0"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -T|--timeout)
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
