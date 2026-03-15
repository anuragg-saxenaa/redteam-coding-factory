#!/usr/bin/env node

const fetch = require('node-fetch').default;

async function testDashboard() {
  console.log('🚀 Testing Dashboard API Endpoints...');
  
  try {
    // Test health endpoint
    console.log('🔍 Testing /api/health...');
    const healthResponse = await fetch('http://localhost:3000/api/health');
    const healthData = await healthResponse.json();
    console.log('Health:', healthData.success ? '✅ OK' : '❌ Failed');
    
    // Test status endpoint
    console.log('🔍 Testing /api/status...');
    const statusResponse = await fetch('http://localhost:3000/api/status');
    const statusData = await statusResponse.json();
    console.log('Status:', statusData.success ? '✅ OK' : '❌ Failed');
    
    // Test tasks endpoint
    console.log('🔍 Testing /api/tasks...');
    const tasksResponse = await fetch('http://localhost:3000/api/tasks');
    const tasksData = await tasksResponse.json();
    console.log('Tasks:', tasksData.success ? '✅ OK' : '❌ Failed');
    
    // Test results endpoint
    console.log('🔍 Testing /api/results...');
    const resultsResponse = await fetch('http://localhost:3000/api/results');
    const resultsData = await resultsResponse.json();
    console.log('Results:', resultsData.success ? '✅ OK' : '❌ Failed');
    
    // Test metrics endpoint
    console.log('🔍 Testing /api/metrics...');
    const metricsResponse = await fetch('http://localhost:3000/api/metrics');
    const metricsData = await metricsResponse.json();
    console.log('Metrics:', metricsData.success ? '✅ OK' : '❌ Failed');
    
    // Test worktrees endpoint
    console.log('🔍 Testing /api/worktrees...');
    const worktreesResponse = await fetch('http://localhost:3000/api/worktrees');
    const worktreesData = await worktreesResponse.json();
    console.log('Worktrees:', worktreesData.success ? '✅ OK' : '❌ Failed');
    
    // Test logs endpoint
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