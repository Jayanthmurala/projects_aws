# Test the fixed container
Write-Host "Testing fixed Nexus Projects Service container..." -ForegroundColor Green

# Start container and capture output
Write-Host "Starting container..." -ForegroundColor Yellow
$containerId = docker run -d -p 4003:4003 --env-file .env nexus-projects-service

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to start container" -ForegroundColor Red
    exit 1
}

Write-Host "Container started with ID: $containerId" -ForegroundColor Green

# Wait for service to initialize
Write-Host "Waiting for service to initialize (30 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

# Check container logs
Write-Host "Container logs:" -ForegroundColor Cyan
docker logs $containerId

# Test health endpoint
Write-Host "`nTesting health endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4003/health" -UseBasicParsing -TimeoutSec 10
    Write-Host "✅ Health check successful!" -ForegroundColor Green
    Write-Host "Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($response.Content)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test root endpoint
Write-Host "`nTesting root endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4003/" -UseBasicParsing -TimeoutSec 10
    Write-Host "✅ Root endpoint successful!" -ForegroundColor Green
    Write-Host "Response: $($response.Content)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Root endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Cleanup
Write-Host "`nStopping container..." -ForegroundColor Yellow
docker stop $containerId | Out-Null
docker rm $containerId | Out-Null

Write-Host "✅ Test completed!" -ForegroundColor Green
