/**
 * Type definitions for GitHub tools
 * These are separate from kodrdriv to maintain independence
 */

export interface PullRequest {
    number: number;
    title: string;
    html_url: string;
    state: 'open' | 'closed';
    head: {
        ref: string;
        sha: string;
    };
    base: {
        ref: string;
    };
    labels?: Array<{
        name: string;
    }>;
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface Milestone {
    number: number;
    title: string;
    state: 'open' | 'closed';
    description?: string;
    due_on?: string;
}

export interface Issue {
    number: number;
    title: string;
    body?: string;
    state: 'open' | 'closed';
    labels: Array<{
        name: string;
    }>;
    html_url: string;
    milestone?: Milestone;
    created_at: string;
    closed_at?: string;
}

export interface Release {
    id: number;
    tag_name: string;
    name: string;
    body?: string;
    draft: boolean;
    prerelease: boolean;
    html_url: string;
}

export interface WorkflowRun {
    id: number;
    name: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out';
    html_url: string;
}

export interface CheckRun {
    id: number;
    name: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
}

// Type for prompt confirmation function (injected dependency)
export type PromptFunction = (message: string) => Promise<boolean>;

// Type for logger (optional peer dependency)
export interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    debug(message: string): void;
}

