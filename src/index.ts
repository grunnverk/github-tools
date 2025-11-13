/**
 * @eldrforge/github-tools
 *
 * GitHub API utilities for automation - PR management, issue tracking, workflow monitoring
 */

// Export all types
export type {
    PullRequest,
    MergeMethod,
    Milestone,
    Issue as GitHubIssue,
    Release,
    WorkflowRun,
    CheckRun,
    PromptFunction,
    Logger,
} from './types';

// Export errors
export { CommandError, ArgumentError } from './errors';

// Export logger configuration
export { setLogger, getLogger } from './logger';

// Export GitHub operations
export {
    // Core API
    getOctokit,
    getCurrentBranchName,
    getRepoDetails,

    // Pull Requests
    createPullRequest,
    findOpenPullRequestByHeadRef,
    waitForPullRequestChecks,
    mergePullRequest,

    // Releases
    createRelease,
    getReleaseByTagName,

    // Milestones
    findMilestoneByTitle,
    createMilestone,
    closeMilestone,
    getOpenIssuesForMilestone,
    moveIssueToMilestone,
    moveOpenIssuesToNewMilestone,
    ensureMilestoneForVersion,
    closeMilestoneForVersion,
    getClosedIssuesForMilestone,
    getMilestoneIssuesForRelease,

    // Issues
    getOpenIssues,
    createIssue,
    getIssueDetails,
    getRecentClosedIssuesForCommit,

    // Workflows
    getWorkflowRunsTriggeredByRelease,
    waitForReleaseWorkflows,
    getWorkflowsTriggeredByRelease,

    // Configuration
    setPromptFunction,
} from './github';

// Export issue operations and types
export {
    get as getIssuesContent,
    handleIssueCreation,
} from './issues';

export type { Issue, ReviewResult } from './issues';

// Export release notes
export {
    findRecentReleaseNotes,
    get as getReleaseNotesContent,
} from './releaseNotes';

