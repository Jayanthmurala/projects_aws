#!/usr/bin/env node

/**
 * Comprehensive Debug Test Script
 * Tests WebSocket and Cache functionality
 */

const BASE_URL = 'http://localhost:4003';

async function makeRequest(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  console.log(`\n🔍 Testing: ${options.method || 'GET'} ${endpoint}`);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    const data = await response.json();
    console.log(`✅ Status: ${response.status}`);
    console.log(`📄 Response:`, JSON.stringify(data, null, 2));
    return { success: response.ok, data, status: response.status };
  } catch (error) {
    console.error(`❌ Error:`, error.message);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🚀 Starting Comprehensive Debug Tests\n');
  console.log('=' .repeat(60));

  // Test 1: Check if server is running
  console.log('\n📋 TEST 1: Server Health Check');
  await makeRequest('/health');

  // Test 2: Check WebSocket health
  console.log('\n📋 TEST 2: WebSocket Health Check');
  await makeRequest('/health/ready');

  // Test 3: Check cache status
  console.log('\n📋 TEST 3: Cache Status');
  await makeRequest('/debug/cache-stats');

  // Test 4: Test cache key generation
  console.log('\n📋 TEST 4: Cache Key Generation');
  await makeRequest('/debug/cache-keys', {
    method: 'POST',
    body: JSON.stringify({
      url: '/v1/projects',
      method: 'GET',
      headers: {
        'authorization': 'Bearer test-token'
      }
    })
  });

  // Test 5: Test WebSocket emission
  console.log('\n📋 TEST 5: WebSocket Event Emission');
  await makeRequest('/debug/test-websocket', {
    method: 'POST'
  });

  // Test 6: Clear cache manually
  console.log('\n📋 TEST 6: Manual Cache Clear');
  await makeRequest('/debug/clear-cache', {
    method: 'POST'
  });

  // Test 7: Check cache after clearing
  console.log('\n📋 TEST 7: Cache Status After Clear');
  await makeRequest('/debug/cache-stats');

  // Test 8: Test actual API endpoints
  console.log('\n📋 TEST 8: Test Projects API (should be cached)');
  await makeRequest('/v1/projects?limit=5');

  // Test 9: Check cache after API call
  console.log('\n📋 TEST 9: Cache Status After API Call');
  await makeRequest('/debug/cache-stats');

  console.log('\n' + '='.repeat(60));
  console.log('🎉 All tests completed!');
  console.log('\n📝 ANALYSIS CHECKLIST:');
  console.log('1. ✅ Server should be healthy');
  console.log('2. ✅ WebSocket should show connected status');
  console.log('3. ✅ Cache should be working (memory or redis)');
  console.log('4. ✅ WebSocket events should emit successfully');
  console.log('5. ✅ Cache should clear when requested');
  console.log('6. ✅ API calls should create cache entries');
  console.log('\n🔍 Check server logs for:');
  console.log('- "🚀 EMITTING PROJECT UPDATE" messages');
  console.log('- "🚨 CLEARING ALL API CACHE" messages');
  console.log('- WebSocket connection logs');
  console.log('- Cache operation logs');
}

// Run the tests
runTests().catch(console.error);
