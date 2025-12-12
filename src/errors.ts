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

export class PullRequestCreationError extends Error {
    public readonly statusCode: number;
    public readonly existingPRNumber?: number;
    public readonly existingPRUrl?: string;
    public readonly head: string;
    public readonly base: string;
    public readonly details?: any;

    constructor(
        message: string,
        statusCode: number,
        head: string,
        base: string,
        details?: any,
        existingPRNumber?: number,
        existingPRUrl?: string
    ) {
        super(message);
        this.name = 'PullRequestCreationError';
        this.statusCode = statusCode;
        this.head = head;
        this.base = base;
        this.details = details;
        this.existingPRNumber = existingPRNumber;
        this.existingPRUrl = existingPRUrl;
    }

    getRecoveryInstructions(): string {
        if (this.statusCode === 422) {
            const errorMessage = this.details?.message || '';

            // Check for specific 422 error patterns
            if (errorMessage.includes('pull request already exists') ||
                errorMessage.includes('A pull request already exists')) {
                const instructions = [`❌ Failed to create PR: A pull request already exists for ${this.head} → ${this.base}`];

                if (this.existingPRUrl) {
                    instructions.push('');
                    instructions.push(`📋 Existing PR: ${this.existingPRUrl}`);
                }

                instructions.push('');
                instructions.push('Options:');
                if (this.existingPRNumber) {
                    instructions.push(`  1. Reuse existing PR #${this.existingPRNumber} (command will detect and continue automatically)`);
                    instructions.push(`  2. Close existing PR: gh pr close ${this.existingPRNumber}`);
                } else {
                    instructions.push('  1. Check for existing PRs: gh pr list');
                    instructions.push('  2. Close existing PR if needed: gh pr close <number>');
                }
                instructions.push(`  3. Use different branch name`);

                return instructions.join('\n');
            }

            if (errorMessage.includes('No commits between') ||
                errorMessage.includes('head and base')) {
                return `❌ Failed to create PR: No commits between ${this.head} and ${this.base}

This usually means:
  • The branches are already in sync
  • No changes have been pushed to ${this.head}

What to do:
  1. Verify you're on the correct branch: git branch
  2. Check if there are unpushed commits: git log ${this.base}..${this.head}
  3. If no changes exist, there's nothing to publish`;
            }

            if (errorMessage.includes('Validation Failed') ||
                errorMessage.includes('field')) {
                return `❌ Failed to create PR: Validation error

Error details: ${errorMessage}

Common causes:
  • PR title too long (max 256 characters)
  • Invalid characters in title or body
  • Branch protection rules preventing PR creation

What to do:
  1. Check your commit message is valid: git log -1
  2. Verify branch protection settings in GitHub
  3. Try creating the PR manually to see detailed error`;
            }
        }

        // Generic recovery instructions
        return `❌ Failed to create pull request (HTTP ${this.statusCode})

Error: ${this.details?.message || 'Unknown error'}

What to do:
  1. Check GitHub API status: https://www.githubstatus.com/
  2. Verify GITHUB_TOKEN permissions (needs 'repo' scope)
  3. Check if base branch (${this.base}) exists
  4. Verify working directory is clean: git status
  5. Try viewing existing PRs: gh pr list --head ${this.head}`;
    }
}

