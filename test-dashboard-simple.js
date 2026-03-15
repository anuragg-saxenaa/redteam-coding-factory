#!/usr/bin/env node

const fetch = require('node-fetch').default;

async function testDashboard() {
  console.log('🚀 Testing Dashboard API Endpoints...');
  
  try {
    // Test results endpoint (should work)
    console.log('🔍 Testing /api/results...');
    const resultsResponse = await fetch('http://localhost:3000/api/results');
    const resultsData = await resultsResponse.json();
    console.log('Results:', resultsData.success ? '✅ OK' : '❌ Failed');
    
    // Test metrics endpoint (should work)
    console.log('🔍 Testing /api/metrics...');
    const metricsResponse = await fetch('http://localhost:3000/api/metrics');
    const metricsData = await metricsResponse.json();
    console.log('Metrics:', metricsData.success ? '✅ OK' : '❌ Failed');
    
    // Test logs endpoint (should work)
    console.log('🔍 Testing /api/logs...');
    const logsResponse = await fetch('http://localhost:3000/api/logs');
    const logsData = await logsResponse.json();
    console.log('Logs:', logsData.success ? '✅ OK' : '❌ Failed');
    
    // Test dashboard UI
    console.log('🌐 Testing dashboard UI...');
    const uiResponse = await fetch('http://localhost:3000/');
    const uiText = await uiResponse.text();
    const hasDashboard = uiText.includes('🚀 RedTeam Coding Factory Dashboard');
    console.log('Dashboard UI:', hasDashboard ? '✅ OK' : '❌ Failed');
    
    console.log('\n🎉 All tests completed!');
    
  } catch (error) {
    console.error('❌ Error during testing:', error.message);
    process.exit(1);
  }
}

// Wait a bit for dashboard to start
setTimeout(() => {
  testDashboard();
}, 3000);