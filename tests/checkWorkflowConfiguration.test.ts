import { Octokit } from '@octokit/rest';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as child from '@eldrforge/git-tools';
import { checkWorkflowConfiguration } from '../src/github';

vi.mock('@eldrforge/git-tools', () => ({
    run: vi.fn(),
}));

vi.mock('@octokit/rest');

vi.mock('../src/logger', () => ({
    getLogger: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    })),
}));

const mockRun = child.run as Mock;
const MockOctokit = Octokit as unknown as Mock;

describe('checkWorkflowConfiguration', () => {
    const mockOctokit = {
        actions: {
            listRepoWorkflows: vi.fn(),
        },
        repos: {
            getContent: vi.fn(),
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GITHUB_TOKEN = 'test-token';
        MockOctokit.mockImplementation(() => mockOctokit);

        mockRun.mockImplementation(async (command: string) => {
            if (command === 'git remote get-url origin') {
                return { stdout: 'git@github.com:test-owner/test-repo.git' };
            }
            return { stdout: '' };
        });
    });

    afterEach(() => {
        delete process.env.GITHUB_TOKEN;
        vi.clearAllMocks();
    });

    it('should detect when no workflows are configured', async () => {
        mockOctokit.actions.listRepoWorkflows.mockResolvedValue({
            data: {
                workflows: [],
            },
        });

        const result = await checkWorkflowConfiguration('main');

        expect(result).toEqual({
            hasWorkflows: false,
            workflowCount: 0,
            hasPullRequestTriggers: false,
            triggeredWorkflowNames: [],
            warning: 'No GitHub Actions workflows are configured in this repository',
        });
    });

    it('should detect workflows that trigger on pull requests', async () => {
        const workflowContent = `
name: CI
on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
`;

        mockOctokit.actions.listRepoWorkflows.mockResolvedValue({
            data: {
                workflows: [
                    {
                        id: 1,
                        name: 'CI',
                        path: '.github/workflows/ci.yml',
                    },
                ],
            },
        });

        mockOctokit.repos.getContent.mockResolvedValue({
            data: {
                type: 'file',
                content: Buffer.from(workflowContent).toString('base64'),
            },
        });

        const result = await checkWorkflowConfiguration('main');

        expect(result).toEqual({
            hasWorkflows: true,
            workflowCount: 1,
            hasPullRequestTriggers: true,
            triggeredWorkflowNames: ['CI'],
            warning: undefined,
        });
    });

    it('should detect when workflows exist but do not trigger on pull requests', async () => {
        const workflowContent = `
name: Release
on:
  release:
    types: [published]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
`;

        mockOctokit.actions.listRepoWorkflows.mockResolvedValue({
            data: {
                workflows: [
                    {
                        id: 1,
                        name: 'Release',
                        path: '.github/workflows/release.yml',
                    },
                ],
            },
        });

        mockOctokit.repos.getContent.mockResolvedValue({
            data: {
                type: 'file',
                content: Buffer.from(workflowContent).toString('base64'),
            },
        });

        const result = await checkWorkflowConfiguration('main');

        expect(result).toEqual({
            hasWorkflows: true,
            workflowCount: 1,
            hasPullRequestTriggers: false,
            triggeredWorkflowNames: [],
            warning: '1 workflow(s) are configured, but none appear to trigger on pull requests to main',
        });
    });

    it('should detect when workflows trigger on PRs but not to the target branch', async () => {
        const workflowContent = `
name: CI
on:
  pull_request:
    branches: [develop, feature/*]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
`;

        mockOctokit.actions.listRepoWorkflows.mockResolvedValue({
            data: {
                workflows: [
                    {
                        id: 1,
                        name: 'CI',
                        path: '.github/workflows/ci.yml',
                    },
                ],
            },
        });

        mockOctokit.repos.getContent.mockResolvedValue({
            data: {
                type: 'file',
                content: Buffer.from(workflowContent).toString('base64'),
            },
        });

        const result = await checkWorkflowConfiguration('main');

        expect(result).toEqual({
            hasWorkflows: true,
            workflowCount: 1,
            hasPullRequestTriggers: false,
            triggeredWorkflowNames: [],
            warning: '1 workflow(s) are configured, but none appear to trigger on pull requests to main',
        });
    });

    it('should detect workflows with wildcard branch patterns', async () => {
        const workflowContent = `
name: CI
on:
  pull_request:
    branches: ['**']
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
`;

        mockOctokit.actions.listRepoWorkflows.mockResolvedValue({
            data: {
                workflows: [
                    {
                        id: 1,
                        name: 'CI',
                        path: '.github/workflows/ci.yml',
                    },
                ],
            },
        });

        mockOctokit.repos.getContent.mockResolvedValue({
            data: {
                type: 'file',
                content: Buffer.from(workflowContent).toString('base64'),
            },
        });

        const result = await checkWorkflowConfiguration('main');

        expect(result).toEqual({
            hasWorkflows: true,
            workflowCount: 1,
            hasPullRequestTriggers: true,
            triggeredWorkflowNames: ['CI'],
            warning: undefined,
        });
    });

    it('should detect workflows without branch filters (triggers on all PRs)', async () => {
        const workflowContent = `
name: CI
on: pull_request
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
`;

        mockOctokit.actions.listRepoWorkflows.mockResolvedValue({
            data: {
                workflows: [
                    {
                        id: 1,
                        name: 'CI',
                        path: '.github/workflows/ci.yml',
                    },
                ],
            },
        });

        mockOctokit.repos.getContent.mockResolvedValue({
            data: {
                type: 'file',
                content: Buffer.from(workflowContent).toString('base64'),
            },
        });

        const result = await checkWorkflowConfiguration('main');

        expect(result).toEqual({
            hasWorkflows: true,
            workflowCount: 1,
            hasPullRequestTriggers: true,
            triggeredWorkflowNames: ['CI'],
            warning: undefined,
        });
    });

    it('should handle multiple workflows with mixed configurations', async () => {
        const ciWorkflowContent = `
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
`;

        const releaseWorkflowContent = `
name: Release
on:
  release:
    types: [published]
jobs:
  publish:
    runs-on: ubuntu-latest
`;

        mockOctokit.actions.listRepoWorkflows.mockResolvedValue({
            data: {
                workflows: [
                    {
                        id: 1,
                        name: 'CI',
                        path: '.github/workflows/ci.yml',
                    },
                    {
                        id: 2,
                        name: 'Release',
                        path: '.github/workflows/release.yml',
                    },
                ],
            },
        });

        mockOctokit.repos.getContent
            .mockResolvedValueOnce({
                data: {
                    type: 'file',
                    content: Buffer.from(ciWorkflowContent).toString('base64'),
                },
            })
            .mockResolvedValueOnce({
                data: {
                    type: 'file',
                    content: Buffer.from(releaseWorkflowContent).toString('base64'),
                },
            });

        const result = await checkWorkflowConfiguration('main');

        expect(result).toEqual({
            hasWorkflows: true,
            workflowCount: 2,
            hasPullRequestTriggers: true,
            triggeredWorkflowNames: ['CI'],
            warning: undefined,
        });
    });

    it('should handle API errors gracefully', async () => {
        mockOctokit.actions.listRepoWorkflows.mockRejectedValue(
            new Error('API rate limit exceeded')
        );

        const result = await checkWorkflowConfiguration('main');

        // Should assume workflows might exist to avoid false negatives
        expect(result).toEqual({
            hasWorkflows: true,
            workflowCount: -1,
            hasPullRequestTriggers: true,
            triggeredWorkflowNames: [],
        });
    });
});

