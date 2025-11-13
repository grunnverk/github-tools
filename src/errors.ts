/**
 * Error types for github-tools
 */

export class CommandError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CommandError';
    }
}

export class ArgumentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ArgumentError';
    }
}

export class PullRequestCheckError extends Error {
    public readonly prNumber: number;
    public readonly failedChecks: any[];
    public readonly prUrl: string;

    constructor(message: string, prNumber?: number, failedChecks?: any[], prUrl?: string) {
        super(message);
        this.name = 'PullRequestCheckError';
        this.prNumber = prNumber || 0;
        this.failedChecks = failedChecks || [];
        this.prUrl = prUrl || '';
    }

    getRecoveryInstructions(): string {
        return `To resolve failed PR checks:
1. Review the failed checks at: ${this.prUrl}
2. Fix the issues identified
3. Push the fixes
4. Re-run this command`;
    }
}

