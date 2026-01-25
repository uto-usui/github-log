# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A TypeScript CLI tool that fetches merged pull requests from GitHub for a specific user and:
- Writes results to a JSON file in the `out/` directory
- Sends a formatted message to Slack with PR details

## Commands

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Run (default: last 7 days)
pnpm start

# Run with specific time periods
pnpm start:week          # 7 days
pnpm start:two-weeks     # 14 days
pnpm start:one-month     # 30 days
pnpm start:three-months  # 90 days
pnpm start:six-months    # 180 days
pnpm start:one-year      # 365 days

# Run with custom days
node dist/fetchMergedPRs.js <days>

# Clean build artifacts
pnpm start:clean
```

## Environment Variables

Create a `.env` file with:
```
SLACK_TOKEN=<Slack bot token>
GITHUB_TOKEN=<GitHub personal access token>
GITHUB_USER_NAME=<GitHub username to search PRs for>
SLACK_CHANNEL=<Slack channel ID>
```

## Code Style

- Prettier: no semicolons, single quotes, 100 char line width, no trailing commas
- TypeScript strict mode enabled
