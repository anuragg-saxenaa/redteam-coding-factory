#!/usr/bin/env node
/**
 * RedTeam Coding Factory — MCP Server
 *
 * Exposes the coding factory as an MCP (Model Context Protocol) server so it
 * can be used as a plugin inside Claude Code, Codex, or any MCP-compatible AI agent.
 *
 * Install:
 *   npm install -g redteam-coding-factory
 *
 * Add to Claude Code (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "coding-factory": {
 *         "command": "npx",
 *         "args": ["redteam-coding-factory", "--mcp"],
 *         "env": {
 *           "GITHUB_TOKEN": "ghp_...",
 *           "FACTORY_WORKSPACE": "/path/to/workspace"
 *         }
 *       }
 *     }
 *   }
 */

import { createServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import IssueWatcher from './issue-watcher.js';
import RedTeamFactory from './redteam-factory.js';
import path from 'path';
import fs from 'fs';

const WORKSPACE = process.env.FACTORY_WORKSPACE || process.cwd();
const PR_LOG = path.join(WORKSPACE, 'pr-log.md');

const server = createServer(
  { name: 'redteam-coding-factory', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_issue_watcher',
      description:
        'Pick open GitHub issues from a repo, implement full fixes, and open PRs autonomously. ' +
        'Supports Java/Spring AI, TypeScript, Python, and Mobile stacks.',
      inputSchema: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'GitHub repo in org/name format (e.g. spring-projects/spring-ai)',
          },
          stream: {
            type: 'string',
            enum: ['java-spring', 'typescript', 'python', 'mobile', 'auto'],
            description: 'Technology stream. Use "auto" to detect from repo language.',
            default: 'auto',
          },
          max_prs: {
            type: 'number',
            description: 'Max PRs to open in this run (default: 2)',
            default: 2,
          },
          dry_run: {
            type: 'boolean',
            description: 'If true, implement but do not push or create PR',
            default: false,
          },
        },
        required: ['repo'],
      },
    },
    {
      name: 'run_oss_discovery',
      description:
        'Search trending GitHub repos, evaluate fit, and write contribution specs. ' +
        'Prioritizes Java AI projects (Spring AI, LangChain4j) and repos with 5k+ stars.',
      inputSchema: {
        type: 'object',
        properties: {
          focus: {
            type: 'string',
            enum: ['java-ai', 'any', 'typescript', 'python'],
            description: 'Priority focus for discovery. "java-ai" targets Spring AI / LangChain4j.',
            default: 'java-ai',
          },
          min_stars: {
            type: 'number',
            description: 'Minimum star count for candidate repos (default: 5000)',
            default: 5000,
          },
          output_file: {
            type: 'string',
            description: 'Path to write backlog specs (default: ./backlog.md)',
            default: './backlog.md',
          },
        },
      },
    },
    {
      name: 'get_pr_log',
      description: 'Get the log of all PRs opened by the coding factory.',
      inputSchema: {
        type: 'object',
        properties: {
          last_n: {
            type: 'number',
            description: 'Return only the last N entries (default: 20)',
            default: 20,
          },
        },
      },
    },
    {
      name: 'get_factory_status',
      description: 'Get the current status of all coding factory streams and recent activity.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'run_issue_watcher': {
        const { repo, stream = 'auto', max_prs = 2, dry_run = false } = args;
        const [owner, repoName] = repo.split('/');
        if (!owner || !repoName) {
          return { content: [{ type: 'text', text: `Error: repo must be in org/name format` }], isError: true };
        }

        const detectedStream = stream === 'auto' ? detectStream(repo) : stream;
        const factory = new RedTeamFactory({
          workspaceRoot: WORKSPACE,
          dataDir: path.join(WORKSPACE, '.factory-data'),
          stream: detectedStream,
          enablePush: !dry_run,
          createPR: !dry_run,
          maxTasksPerRun: max_prs,
        });

        factory.initialize([{ name: repoName, owner, branch: 'main' }]);
        const results = await factory.run();

        const summary = results.map(r =>
          `${r.success ? '✅' : '❌'} ${r.repo}: ${r.pr_url || r.error || 'no fixable issues found'}`
        ).join('\n');

        return { content: [{ type: 'text', text: `IssueWatcher run complete:\n\n${summary}` }] };
      }

      case 'run_oss_discovery': {
        const { focus = 'java-ai', min_stars = 5000, output_file = './backlog.md' } = args;

        const queries = focus === 'java-ai'
          ? [
              'github spring-projects spring-ai open issues 2026',
              'github langchain4j langchain4j good first issue 2026',
              'github java AI framework 5000 stars 2026 open source',
            ]
          : [
              'trending github repositories 2026 AI developer tools',
              'new open source project 2026 popular github 5000 stars',
            ];

        return {
          content: [{
            type: 'text',
            text: `OSS Discovery configured.\n\nFocus: ${focus}\nMin stars: ${min_stars}\nSearch queries:\n${queries.map(q => `  - ${q}`).join('\n')}\n\nRun with a live agent to execute searches and write specs to ${output_file}.`,
          }],
        };
      }

      case 'get_pr_log': {
        const { last_n = 20 } = args;
        if (!fs.existsSync(PR_LOG)) {
          return { content: [{ type: 'text', text: 'No PR log found. No PRs have been opened yet.' }] };
        }
        const lines = fs.readFileSync(PR_LOG, 'utf8').trim().split('\n');
        const dataLines = lines.filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Date'));
        const recent = dataLines.slice(-last_n);
        return {
          content: [{
            type: 'text',
            text: `Last ${recent.length} PRs:\n\n| Date | Repo | PR | Description |\n|---|---|---|---|\n${recent.join('\n')}`,
          }],
        };
      }

      case 'get_factory_status': {
        const prCount = fs.existsSync(PR_LOG)
          ? fs.readFileSync(PR_LOG, 'utf8').split('\n').filter(l => l.startsWith('|') && l.includes('github.com')).length
          : 0;

        return {
          content: [{
            type: 'text',
            text: `RedTeam Coding Factory Status\n\nStreams:\n  A — Java AI (Spring AI, LangChain4j, Quarkus) — Mon/Tue/Thu/Sat\n  B — TypeScript (9router, eko) — Wed\n  C — Python (LiteMultiAgent) — Fri\n  D — Mobile (SwiftFormat, React Native) — Sun\n\nTotal PRs opened: ${prCount}\nPR log: ${PR_LOG}\n\nFor live status, run: openclaw cron list`,
          }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

function detectStream(repo) {
  const r = repo.toLowerCase();
  if (r.includes('spring') || r.includes('java') || r.includes('langchain4j') || r.includes('quarkus')) return 'java-spring';
  if (r.includes('swift') || r.includes('ios') || r.includes('android') || r.includes('react-native')) return 'mobile';
  if (r.includes('python') || r.includes('fastapi') || r.includes('langchain')) return 'python';
  return 'typescript';
}

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
