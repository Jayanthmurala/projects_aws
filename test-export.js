// Simple test script to verify export endpoints are working
const fetch = require('node-fetch');

async function testExportEndpoints() {
  const baseUrl = 'http://localhost:4003';
  
  console.log('🧪 Testing HEAD_ADMIN Export Endpoints...\n');
  
  // Test 1: Check if server is running
  try {
    console.log('1. Testing server connectivity...');
    const healthCheck = await fetch(`${baseUrl}/health`);
    console.log(`   ✅ Server is running (Status: ${healthCheck.status})`);
  } catch (error) {
    console.log('   ❌ Server is not running or not accessible');
    console.log('   💡 Please start the projects-service: npm run dev');
    return;
  }
  
  // Test 2: Check export endpoints exist
  const testToken = 'test-jwt-token'; // You'll need a real JWT token
  
  const endpoints = [
    '/v1/admin/head/export/applications',
    '/v1/admin/head/export?type=applications',
    '/v1/admin/head/audit-logs',
    '/v1/admin/head/projects/test-id/activity'
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`\n2. Testing endpoint: ${endpoint}`);
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`   Status: ${response.status}`);
      
      if (response.status === 401) {
        console.log('   ⚠️  Authentication required (expected)');
      } else if (response.status === 404) {
        console.log('   ❌ Endpoint not found - check route registration');
      } else if (response.status >= 200 && response.status < 300) {
        console.log('   ✅ Endpoint accessible');
      } else {
        console.log(`   ⚠️  Unexpected status: ${response.status}`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n📋 Test Summary:');
  console.log('- If you see 401 (Authentication required), the endpoints exist but need valid JWT');
  console.log('- If you see 404 (Not found), check if routes are properly registered');
  console.log('- If you see 200-299, the endpoints are working correctly');
  console.log('\n💡 To test with authentication:');
  console.log('1. Start the projects-service: npm run dev');
  console.log('2. Get a valid HEAD_ADMIN JWT token from auth-service');
  console.log('3. Use Postman or curl with Authorization header');
}

testExportEndpoints().catch(console.error);
