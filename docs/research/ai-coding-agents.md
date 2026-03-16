# Research: AI Coding Agents (March 2026)

## Overview
This document tracks the latest developments in autonomous coding agents relevant to the RedTeam Coding Factory.

## Major Players

### 1. Devin (Cognition AI)
- First AI software engineer
- Autonomous debugging, code generation, deployment
- SWE-bench Verified: ~13% resolution rate early versions
- Current focus: Enterprise integration

### 2. SWE-agent (Stanford)
- Open source AI coding agent
- Built on Claude Sonnet
- Commands: Edit, Search, Bash, Grep
- Strong on SWE-bench tasks

### 3. OpenHands (All-Hands AI)
- Open source AI coding assistant
- Docker-based runtime isolation
- Integrates with GitHub Actions
- Active community development

### 4. Aider
- Terminal-based AI pair programming
- Git-aware (auto-commits)
- Supports multiple models
- Fast iteration cycle

## Key Patterns

### Worktree Isolation
- All major agents use git worktrees for isolation
- Prevents cross-task contamination
- Enables parallel execution

### Self-Healing
- Failed tests trigger code fixes
- Loop until pass or max attempts
- Classification of failure types (lint, test, type)

### Multi-Agent Coordination
- Planner → Executor → Reviewer pattern
- A2A (Agent-to-Agent) protocol emerging
- Session management for long-running tasks

## Integration Opportunities

### MCP (Model Context Protocol)
- Anthropic's standard for tool integration
- Enables agents to call external services
- Could integrate with factory pipeline

### SWE-bench Verified
- Canonical benchmark for coding agents
- Factory should target SWE-bench Verified tasks
- Policy: `docs/BENCHMARK-POLICY.md`

## Notes

- Last updated: 2026-03-15
- Status: Research in progress
- Next: Prototype agent integration with OpenHands
