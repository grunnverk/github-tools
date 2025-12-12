import { describe, it, expect } from 'vitest';
import { PullRequestCreationError } from '../src/errors';

describe('PullRequestCreationError functionality', () => {
    describe('error handling and recovery instructions', () => {
        it('should provide recovery instructions for existing PR with PR number', () => {
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
            expect(instructions).toContain('Reuse existing PR');
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

        it('should provide generic recovery for non-422 errors', () => {
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
        });

        it('should store all error properties correctly', () => {
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

    describe('PR reuse logic', () => {
        it('should indicate when PR can be reused', () => {
            const error = new PullRequestCreationError(
                'Failed',
                422,
                'working',
                'main',
                { message: 'A pull request already exists' },
                123,
                'https://github.com/owner/repo/pull/123'
            );

            const instructions = error.getRecoveryInstructions();

            // Should suggest reusing existing PR
            expect(instructions).toContain('Reuse existing PR');
            expect(instructions).toContain('PR #123');
        });

        it('should provide alternative options when PR exists', () => {
            const error = new PullRequestCreationError(
                'Failed',
                422,
                'working',
                'main',
                { message: 'A pull request already exists' },
                123
            );

            const instructions = error.getRecoveryInstructions();

            // Should provide multiple options
            expect(instructions).toContain('Options:');
            expect(instructions).toContain('Close existing PR');
            expect(instructions).toContain('Use different branch');
        });
    });
});
