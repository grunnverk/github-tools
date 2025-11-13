# @eldrforge/github-tools

GitHub API utilities for automation - PR management, issue tracking, workflow monitoring.

## Features

- **Pull Request Management** - Create, update, merge, and find PRs
- **Issue Operations** - Create issues, list open issues, search recent closures
- **Milestone Management** - Create, close, and find milestones
- **Release Operations** - Create releases, get releases by tag
- **Workflow Monitoring** - Wait for workflow completion, get workflow runs
- **Branch Operations** - Delete branches programmatically
- **Flexible Logging** - Bring your own logger or use the built-in console logger
- **Injectable Prompt** - Provide custom prompt functions for interactive operations

## Installation

```bash
npm install @eldrforge/github-tools
```

## Quick Start

```typescript
import { createPullRequest, mergePullRequest, getRepoDetails } from '@eldrforge/github-tools';

// Get repository details
const { owner, repo } = await getRepoDetails();
console.log(`Repository: ${owner}/${repo}`);

// Create a pull request
const pr = await createPullRequest(
    'feat: Add new feature',
    'Detailed description of the changes',
    'feature-branch',
    'main'
);
console.log(`Created PR #${pr.number}: ${pr.html_url}`);

// Merge the pull request
await mergePullRequest(pr.number, 'squash', 'feat: Add new feature (#123)');
console.log('PR merged successfully!');
```

## Environment Variables

**Required**:
- `GITHUB_TOKEN`: GitHub personal access token with appropriate permissions

```bash
export GITHUB_TOKEN="ghp_your_token_here"
```

## Custom Logger

By default, github-tools uses a console-based logger. You can provide your own logger implementation (e.g., Winston):

```typescript
import { setLogger } from '@eldrforge/github-tools';
import winston from 'winston';

// Create Winston logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

// Use Winston with github-tools
setLogger(logger);
```

## Custom Prompt Function

For interactive operations (like merge confirmations), you can provide a custom prompt function:

```typescript
import { setPromptFunction } from '@eldrforge/github-tools';

// Custom prompt implementation
const myPrompt = async (message: string): Promise<boolean> => {
    // Your custom prompt logic (e.g., CLI prompts, UI dialogs, etc.)
    const answer = await askUser(message);
    return answer === 'yes';
};

// Use custom prompt with github-tools
setPromptFunction(myPrompt);
```

## Core Modules

### Pull Request Operations

```typescript
import {
    createPullRequest,
    findOpenPullRequestByHeadRef,
    updatePullRequest,
    mergePullRequest
} from '@eldrforge/github-tools';

// Create PR
const pr = await createPullRequest('title', 'body', 'head', 'base');

// Find existing PR
const existingPr = await findOpenPullRequestByHeadRef('feature-branch');

// Update PR
await updatePullRequest(pr.number, {
    title: 'Updated title',
    body: 'Updated description'
});

// Merge PR
await mergePullRequest(pr.number, 'squash', 'Commit title');
```

### Issue Operations

```typescript
import {
    createIssue,
    getOpenIssues,
    getRecentClosedIssuesForCommit
} from '@eldrforge/github-tools';

// Create issue
const issue = await createIssue(
    'Bug: Something is broken',
    'Detailed description',
    ['bug', 'priority-high']
);

// Get all open issues
const openIssues = await getOpenIssues();

// Get issues closed in recent commits
const closedIssues = await getRecentClosedIssuesForCommit('v1.0.0', 'v1.1.0', 50);
```

### Milestone Operations

```typescript
import {
    findMilestoneByTitle,
    createMilestone,
    closeMilestone
} from '@eldrforge/github-tools';

// Find existing milestone
const milestone = await findMilestoneByTitle('v1.0.0');

// Create new milestone
const newMilestone = await createMilestone(
    'v1.1.0',
    'Release 1.1.0 milestone'
);

// Close milestone
await closeMilestone(milestone.number);
```

### Release Operations

```typescript
import {
    createGitHubRelease,
    getReleaseByTag,
    getAllReleases
} from '@eldrforge/github-tools';

// Create release
await createGitHubRelease(
    'v1.0.0',
    'Release 1.0.0',
    '## Changes\n- Feature 1\n- Feature 2',
    false,  // not a draft
    false   // not a prerelease
);

// Get specific release
const release = await getReleaseByTag('v1.0.0');

// Get all releases
const allReleases = await getAllReleases();
```

### Workflow Operations

```typescript
import {
    waitForWorkflowsToComplete,
    getWorkflowRunsForCommit
} from '@eldrforge/github-tools';

// Wait for workflows to complete (with timeout)
await waitForWorkflowsToComplete('abc123', 300); // 5 minutes

// Get workflow runs for a commit
const runs = await getWorkflowRunsForCommit('abc123');
```

## API Documentation

### Pull Request Functions

| Function | Description |
|----------|-------------|
| `createPullRequest(title, body, head, base?)` | Creates a new pull request |
| `findOpenPullRequestByHeadRef(headRef)` | Finds open PR by head branch |
| `updatePullRequest(number, updates)` | Updates PR title/body |
| `mergePullRequest(number, method, title?)` | Merges a pull request |
| `deleteBranch(branchName)` | Deletes a branch |

### Issue Functions

| Function | Description |
|----------|-------------|
| `createIssue(title, body, labels?)` | Creates a new issue |
| `getOpenIssues()` | Gets all open issues |
| `getRecentClosedIssuesForCommit(from, to, limit)` | Gets recently closed issues |

### Milestone Functions

| Function | Description |
|----------|-------------|
| `findMilestoneByTitle(title)` | Finds milestone by title |
| `createMilestone(title, description?)` | Creates a new milestone |
| `closeMilestone(number)` | Closes a milestone |

### Release Functions

| Function | Description |
|----------|-------------|
| `createGitHubRelease(tag, name, body, draft, prerelease)` | Creates a GitHub release |
| `getReleaseByTag(tag)` | Gets release by tag name |
| `getAllReleases()` | Gets all releases |

### Workflow Functions

| Function | Description |
|----------|-------------|
| `waitForWorkflowsToComplete(sha, timeout?)` | Waits for workflows to complete |
| `getWorkflowRunsForCommit(sha)` | Gets workflow runs for commit |
| `getAllWorkflowRuns()` | Gets all workflow runs |
| `getCheckRunsForRef(ref)` | Gets check runs for a ref |

### Utility Functions

| Function | Description |
|----------|-------------|
| `getOctokit()` | Gets configured Octokit instance |
| `getCurrentBranchName()` | Gets current branch name |
| `getRepoDetails()` | Gets owner and repo name |
| `setLogger(logger)` | Sets custom logger |
| `setPromptFunction(fn)` | Sets custom prompt function |

## Security

This library requires a GitHub personal access token with appropriate permissions:

- **`repo`** scope for private repositories
- **`public_repo`** scope for public repositories
- **`workflow`** scope if you need to interact with GitHub Actions

Store your token securely:
```bash
# Never commit tokens to version control
export GITHUB_TOKEN="ghp_your_token_here"
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm run test

# Lint
npm run lint

# Watch mode
npm run watch
```

## Dependencies

- **@eldrforge/git-tools**: Git operations and utilities
- **@octokit/rest**: GitHub API client
- **winston** (peer, optional): Logging framework

## License

Apache-2.0 - see [LICENSE](LICENSE) file for details.

## Author

Calen Varek <calenvarek@gmail.com>

## Related Projects

- [kodrdriv](https://github.com/calenvarek/kodrdriv) - AI-powered Git workflow automation tool
- [@eldrforge/git-tools](https://github.com/calenvarek/git-tools) - Git utilities for automation


TEST
