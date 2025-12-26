import { describe, it, expect } from 'vitest';
import { PullRequestCreationError, PullRequestCheckError, CommandError, ArgumentError } from '../src/errors';

describe('CommandError', () => {
    it('should create an error with correct properties', () => {
        const error = new CommandError('Command failed');
        expect(error.message).toBe('Command failed');
        expect(error.name).toBe('CommandError');
        expect(error instanceof Error).toBe(true);
    });

    it('should set correct error name', () => {
        const error = new CommandError('Test message');
        expect(error.name).toBe('CommandError');
    });
});

describe('ArgumentError', () => {
    it('should create an error with correct properties', () => {
        const error = new ArgumentError('Invalid argument');
        expect(error.message).toBe('Invalid argument');
        expect(error.name).toBe('ArgumentError');
        expect(error instanceof Error).toBe(true);
    });

    it('should set correct error name', () => {
        const error = new ArgumentError('Test message');
        expect(error.name).toBe('ArgumentError');
    });
});

describe('PullRequestCreationError', () => {
    describe('422 errors', () => {
        it('should provide recovery instructions for existing PR', () => {
            const error = new PullRequestCreationError(
                'Failed',
                422,
                'working',
                'main',
                { message: 'A pull request already exists for user:working' },
                123,
                'https://github.com/owner/repo/pull/123'
            );

            const instructions = error.getRecoveryInstructions();

            expect(instructions).toContain('pull request already exists');
            expect(instructions).toContain('working → main');
            expect(instructions).toContain('PR #123');
            expect(instructions).toContain('https://github.com/owner/repo/pull/123');
            expect(instructions).toContain('gh pr close 123');
        });

        it('should provide recovery instructions without PR number', () => {
            const error = new PullRequestCreationError(
                'Failed',
                422,
                'working',
                'main',
                { message: 'pull request already exists' }
            );

            const instructions = error.getRecoveryInstructions();

            expect(instructions).toContain('gh pr list');
            expect(instructions).toContain('Use different branch name');
        });

        it('should handle no commits between branches', () => {
            const error = new PullRequestCreationError(
                'Failed',
                422,
                'working',
                'main',
                { message: 'No commits between working and main' }
            );

            const instructions = error.getRecoveryInstructions();

            expect(instructions).toContain('No commits between');
            expect(instructions).toContain('branches are already in sync');
            expect(instructions).toContain('git log main..working');
        });

        it('should handle validation errors', () => {
            const error = new PullRequestCreationError(
                'Failed',
                422,
                'working',
                'main',
                { message: 'Validation Failed: title is too long' }
            );

            const instructions = error.getRecoveryInstructions();

            expect(instructions).toContain('Validation error');
            expect(instructions).toContain('title is too long');
            expect(instructions).toContain('PR title too long');
        });

        it('should provide generic 422 recovery for unknown cases', () => {
            const error = new PullRequestCreationError(
                'Failed',
                422,
                'working',
                'main',
                { message: 'Some unknown 422 error' }
            );

            const instructions = error.getRecoveryInstructions();

            expect(instructions).toContain('Failed to create pull request');
            expect(instructions).toContain('HTTP 422');
        });
    });

    describe('non-422 errors', () => {
        it('should provide generic recovery for other HTTP errors', () => {
            const error = new PullRequestCreationError(
                'Failed',
                401,
                'working',
                'main',
                { message: 'Bad credentials' }
            );

            const instructions = error.getRecoveryInstructions();

            expect(instructions).toContain('HTTP 401');
            expect(instructions).toContain('Bad credentials');
            expect(instructions).toContain('GITHUB_TOKEN permissions');
            expect(instructions).toContain('githubstatus.com');
        });
    });

    describe('error properties', () => {
        it('should store all error details', () => {
            const error = new PullRequestCreationError(
                'Test message',
                422,
                'working',
                'main',
                { message: 'Details' },
                123,
                'https://example.com'
            );

            expect(error.message).toBe('Test message');
            expect(error.statusCode).toBe(422);
            expect(error.head).toBe('working');
            expect(error.base).toBe('main');
            expect(error.details).toEqual({ message: 'Details' });
            expect(error.existingPRNumber).toBe(123);
            expect(error.existingPRUrl).toBe('https://example.com');
            expect(error.name).toBe('PullRequestCreationError');
        });
    });
});

describe('PullRequestCheckError', () => {
    describe('getRecoveryInstructions', () => {
        it('should provide basic recovery instructions', () => {
            const error = new PullRequestCheckError(
                'Checks failed',
                123,
                [],
                'https://github.com/owner/repo/pull/123'
            );

            const instructions = error.getRecoveryInstructions();

            expect(instructions).toContain('To resolve failed PR checks');
            expect(instructions).toContain('https://github.com/owner/repo/pull/123');
            expect(instructions).toContain('Fix the issues identified');
            expect(instructions).toContain('Re-run this command');
        });
    });

    describe('error properties', () => {
        it('should store all error details', () => {
            const failedChecks = [
                { name: 'test', conclusion: 'failure' },
                { name: 'lint', conclusion: 'failure' },
            ];

            const error = new PullRequestCheckError(
                'Test message',
                123,
                failedChecks,
                'https://example.com'
            );

            expect(error.message).toBe('Test message');
            expect(error.prNumber).toBe(123);
            expect(error.failedChecks).toEqual(failedChecks);
            expect(error.prUrl).toBe('https://example.com');
            expect(error.name).toBe('PullRequestCheckError');
        });

        it('should handle missing optional parameters', () => {
            const error = new PullRequestCheckError('Test');

            expect(error.prNumber).toBe(0);
            expect(error.failedChecks).toEqual([]);
            expect(error.prUrl).toBe('');
        });
    });
});

