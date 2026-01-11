# @eldrforge/github-tools - Agentic Guide

## Purpose

GitHub API utilities for automation. Provides PR management, issue tracking, workflow monitoring, and release note generation.

## Key Features

- **Pull Request Management** - Create, update, and merge PRs
- **Issue Tracking** - Create and manage GitHub issues
- **Release Notes** - Generate and publish release notes
- **Workflow Monitoring** - Check CI/CD status
- **Authentication** - GitHub token management

## Usage

```typescript
import {
  createPullRequest,
  createIssue,
  publishReleaseNotes,
  getPRStatus
} from '@eldrforge/github-tools';

// Create pull request
const pr = await createPullRequest({
  owner: 'myorg',
  repo: 'myrepo',
  title: 'Feature: Add new command',
  body: 'Description...',
  head: 'feature-branch',
  base: 'main'
});

// Create issue
const issue = await createIssue({
  owner: 'myorg',
  repo: 'myrepo',
  title: 'Bug: Fix validation',
  body: 'Details...'
});

// Publish release notes
await publishReleaseNotes({
  owner: 'myorg',
  repo: 'myrepo',
  tag: 'v1.0.0',
  notes: 'Release notes...'
});
```

## Dependencies

- @eldrforge/git-tools - Git operations
- @octokit/rest - GitHub API client

## Package Structure

```
src/
├── github.ts         # GitHub API client
├── issues.ts         # Issue management
├── releaseNotes.ts   # Release note publishing
├── errors.ts         # Error types
├── types.ts          # Type definitions
├── logger.ts         # Logging utilities
└── index.ts
```

## Key Exports

- `createPullRequest()` - Create GitHub PR
- `mergePullRequest()` - Merge PR
- `createIssue()` - Create issue
- `publishReleaseNotes()` - Publish release notes
- `getPRStatus()` - Check PR CI status
- `getLatestRelease()` - Get latest release info

