/**
 * Dashboard Service
 * Provides API endpoints for monitoring the RedTeam Coding Factory
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';

class DashboardService {
  constructor(factory, options = {}) {
    this.factory = factory;
    this.app = express();
    // Allow port override via options or env; port=0 picks a random free port
    this.port = options.port !== undefined ? options.port
      : (process.env.DASHBOARD_PORT ? parseInt(process.env.DASHBOARD_PORT) : 3000);
    this.dataDir = options.dataDir || './data';
    this.server = null;
    
    this.initialize();
  }

  initialize() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // API Routes
    this.setupRoutes();

    // Serve dashboard UI
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  setupRoutes() {
    // Get factory status
    this.app.get('/api/status', (req, res) => {
      try {
        const status = this.factory.status();
        res.json({
          success: true,
          data: status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get task queue
    this.app.get('/api/tasks', (req, res) => {
      try {
        const tasks = this.factory.taskManager.list();
        res.json({
          success: true,
          data: tasks,
          count: tasks.length
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get recent results
    this.app.get('/api/results', (req, res) => {
      try {
        const results = this.factory.resultLog || [];
        res.json({
          success: true,
          data: results.slice(-20), // Last 20 results
          count: results.length
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get metrics
    this.app.get('/api/metrics', (req, res) => {
      try {
        const metricsPath = path.join(this.dataDir, 'metrics.json');
        if (fs.existsSync(metricsPath)) {
          const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
          res.json({
            success: true,
            data: metrics
          });
        } else {
          res.json({
            success: true,
            data: { message: 'No metrics data found' }
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get worktree status
    this.app.get('/api/worktrees', (req, res) => {
      try {
        const worktrees = this.factory.worktreeManager.list();
        res.json({
          success: true,
          data: worktrees,
          count: worktrees.length
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get logs
    this.app.get('/api/logs', (req, res) => {
      try {
        const logPath = path.join(this.dataDir, 'factory.log');
        if (fs.existsSync(logPath)) {
          const logs = fs.readFileSync(logPath, 'utf8').split('\n').slice(-50).join('\n');
          res.json({
            success: true,
            data: logs
          });
        } else {
          res.json({
            success: true,
            data: 'No logs found'
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Trigger manual task processing
    this.app.post('/api/process', (req, res) => {
      try {
        const { useAgent = false, doPushPR = false } = req.body;
        
        this.factory.processNext(useAgent, doPushPR)
          .then(result => {
            res.json({
              success: true,
              data: result
            });
          })
          .catch(error => {
            res.status(500).json({
              success: false,
              error: error.message
            });
          });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Get health check
    this.app.get('/api/health', (req, res) => {
      try {
        const health = {
          timestamp: new Date().toISOString(),
          factoryRunning: this.factory.isRunning || false,
          taskQueueSize: this.factory.taskManager.list().length,
          worktreesActive: this.factory.worktreeManager.list().length,
          lastResult: this.factory.resultLog && this.factory.resultLog.length > 0 
            ? this.factory.resultLog[this.factory.resultLog.length - 1]
            : null
        };
        
        res.json({
          success: true,
          data: health
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        // After bind, get the actual port (important when port=0)
        this.port = this.server.address().port;
        console.log(`[DashboardService] Dashboard running on http://localhost:${this.port}`);
        resolve(this.server);
      });
      this.server.on('error', reject);
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[DashboardService] Dashboard stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getServer() {
    return this.server;
  }
}

export default DashboardService;