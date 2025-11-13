import { describe, it, expect } from 'vitest';
import type {
    PullRequest,
    MergeMethod,
    Milestone,
    Issue,
    Release,
    WorkflowRun,
    CheckRun,
    PromptFunction,
    Logger
} from '../src/types';

describe('Types', () => {
    it('should define PullRequest type correctly', () => {
        const pr: PullRequest = {
            number: 123,
            title: 'Test PR',
            html_url: 'https://github.com/test/test/pull/123',
            state: 'open',
            head: {
                ref: 'feature',
                sha: 'abc123'
            },
            base: {
                ref: 'main'
            }
        };

        expect(pr.number).toBe(123);
        expect(pr.state).toBe('open');
    });

    it('should define MergeMethod type correctly', () => {
        const methods: MergeMethod[] = ['merge', 'squash', 'rebase'];

        expect(methods).toHaveLength(3);
        expect(methods).toContain('squash');
    });

    it('should define PromptFunction type correctly', () => {
        const prompt: PromptFunction = async (message: string) => {
            return message.includes('yes');
        };

        expect(typeof prompt).toBe('function');
    });

    it('should define Logger interface correctly', () => {
        const logger: Logger = {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
        };

        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
    });
});

