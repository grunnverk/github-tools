import { Octokit } from '@octokit/rest';
import { getLogger } from './logger';
import { PullRequest, MergeMethod, PromptFunction } from './types';
import { run } from '@eldrforge/git-tools';

// Make promptConfirmation injectable
const defaultPrompt: PromptFunction = async (message: string) => {
    // Default to true for non-interactive environments
    // eslint-disable-next-line no-console
    console.warn(`Prompt: ${message} (defaulting to YES in non-interactive mode)`);
    return true;
};

let currentPrompt: PromptFunction = defaultPrompt;

export const setPromptFunction = (fn: PromptFunction): void => {
    currentPrompt = fn;
};

const promptConfirmation = async (message: string): Promise<boolean> => {
    return currentPrompt(message);
};

export const getOctokit = (): Octokit => {
    const logger = getLogger();
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
        logger.error('GITHUB_TOKEN environment variable is not set.');
        throw new Error('GITHUB_TOKEN is not set.');
    }

    return new Octokit({
        auth: token,
    });
};

export const getCurrentBranchName = async (cwd?: string): Promise<string> => {
    const { stdout } = await run('git rev-parse --abbrev-ref HEAD', { cwd });
    return stdout.trim();
};

export const getRepoDetails = async (cwd?: string): Promise<{ owner: string; repo: string }> => {
    try {
        const { stdout } = await run('git remote get-url origin', { cwd, suppressErrorLogging: true });
        const url = stdout.trim();

        // Extract owner/repo from the URL - just look for the pattern owner/repo at the end
        // Works with any hostname or SSH alias:
        // - git@github.com:owner/repo.git
        // - git@github.com-fjell:owner/repo.git
        // - https://github.com/owner/repo.git
        // - ssh://git@host/owner/repo.git
        // Two cases:
        // 1. SSH format: :owner/repo (after colon)
        // 2. HTTPS format: //hostname/owner/repo (need at least 2 path segments)
        const match = url.match(/(?::([^/:]+)\/([^/:]+)|\/\/[^/]+\/([^/:]+)\/([^/:]+))(?:\.git)?$/);
        if (!match) {
            throw new Error(`Could not parse repository owner and name from origin URL: "${url}". Expected format: git@host:owner/repo.git or https://host/owner/repo.git`);
        }

        // Match groups: either [1,2] for SSH or [3,4] for HTTPS
        const owner = match[1] || match[3];
        let repo = match[2] || match[4];

        // Strip .git extension if present
        if (repo.endsWith('.git')) {
            repo = repo.slice(0, -4);
        }

        return { owner, repo };
    } catch (error: any) {
        const logger = getLogger();
        const isNotGitRepo = error.message.includes('not a git repository');
        const hasNoOrigin = error.message.includes('remote origin does not exist');

        if (isNotGitRepo || hasNoOrigin) {
            logger.debug(`Failed to get repository details (expected): ${error.message} (${cwd || process.cwd()})`);
        } else {
            logger.debug(`Failed to get repository details: ${error.message}`);
        }
        throw error;
    }
};

// GitHub API limit for pull request titles
const GITHUB_PR_TITLE_LIMIT = 256;

const truncatePullRequestTitle = (title: string): string => {
    if (title.length <= GITHUB_PR_TITLE_LIMIT) {
        return title;
    }

    // Reserve space for "..." suffix
    const maxLength = GITHUB_PR_TITLE_LIMIT - 3;
    let truncated = title.substring(0, maxLength);

    // Try to break at word boundary to avoid cutting words in half
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    if (lastSpaceIndex > maxLength * 0.8) { // Only use word boundary if it's not too far back
        truncated = truncated.substring(0, lastSpaceIndex);
    }

    return truncated + '...';
};

export const createPullRequest = async (
    title: string,
    body: string,
    head: string,
    base: string = 'main',
    options: { reuseExisting?: boolean; cwd?: string } = {}
): Promise<PullRequest> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(options.cwd);
    const logger = getLogger();

    // Check if PR already exists (pre-flight check)
    if (options.reuseExisting !== false) {
        logger.debug(`Checking for existing PR with head: ${head}`);
        const existingPR = await findOpenPullRequestByHeadRef(head, options.cwd);

        if (existingPR) {
            if (existingPR.base.ref === base) {
                logger.info(`♻️  Reusing existing PR #${existingPR.number}: ${existingPR.html_url}`);
                return existingPR;
            } else {
                logger.warn(`⚠️  Existing PR #${existingPR.number} found but targets different base (${existingPR.base.ref} vs ${base})`);
                logger.warn(`   PR URL: ${existingPR.html_url}`);
                logger.warn(`   You may need to close the existing PR or use a different branch name`);
            }
        }
    }

    // Truncate title if it exceeds GitHub's limit
    const truncatedTitle = truncatePullRequestTitle(title.trim());

    if (truncatedTitle !== title.trim()) {
        logger.debug(`Pull request title truncated from ${title.trim().length} to ${truncatedTitle.length} characters to meet GitHub's 256-character limit`);
    }

    try {
        const response = await octokit.pulls.create({
            owner,
            repo,
            title: truncatedTitle,
            body,
            head,
            base,
        });

        return response.data;
    } catch (error: any) {
        // Enhanced error handling for 422 errors
        if (error.status === 422) {
            const { PullRequestCreationError } = await import('./errors');

            // Try to find existing PR to provide more helpful info
            let existingPR: PullRequest | null = null;
            try {
                existingPR = await findOpenPullRequestByHeadRef(head);
            } catch {
                // Ignore errors finding existing PR
            }

            // If we found an existing PR that matches our target, reuse it instead of failing
            if (existingPR && existingPR.base.ref === base) {
                logger.info(`♻️  Found and reusing existing PR #${existingPR.number} (created after initial check)`);
                logger.info(`   URL: ${existingPR.html_url}`);
                logger.info(`   This can happen when PRs are created in parallel or from a previous failed run`);
                return existingPR;
            }

            const prError = new PullRequestCreationError(
                `Failed to create pull request: ${error.message}`,
                422,
                head,
                base,
                error.response?.data,
                existingPR?.number,
                existingPR?.html_url
            );

            // Log the detailed recovery instructions
            const instructions = prError.getRecoveryInstructions();
            for (const line of instructions.split('\n')) {
                logger.error(line);
            }
            logger.error('');

            throw prError;
        }

        // Re-throw other errors
        throw error;
    }
};

export const findOpenPullRequestByHeadRef = async (head: string, cwd?: string): Promise<PullRequest | null> => {
    const octokit = getOctokit();
    const logger = getLogger();

    try {
        const { owner, repo } = await getRepoDetails(cwd);
        logger.debug(`Searching for open pull requests with head: ${owner}:${head} in ${owner}/${repo}`);

        const response = await octokit.pulls.list({
            owner,
            repo,
            state: 'open',
            head: `${owner}:${head}`,
        });

        logger.debug(`Found ${response.data.length} open pull requests`);
        return (response.data[0] ?? null) as PullRequest | null;
    } catch (error: any) {
        // Only log error if it's NOT a "not a git repository" error which we already logged at debug
        if (!error.message.includes('not a git repository')) {
            logger.error(`Failed to find open pull requests: ${error.message}`);
        } else {
            logger.debug(`Skipping PR search: not a git repository (${cwd || process.cwd()})`);
        }

        if (error.status === 404) {
            logger.error(`Repository not found or access denied. Please check your GITHUB_TOKEN permissions.`);
        }
        throw error;
    }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Check if repository has GitHub Actions workflows configured
const hasWorkflowsConfigured = async (cwd?: string): Promise<boolean> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);

    try {
        const response = await octokit.actions.listRepoWorkflows({
            owner,
            repo,
        });

        return response.data.workflows.length > 0;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error: any) {
        // If we can't check workflows (e.g., no Actions permission), assume they might exist
        return true;
    }
};

/**
 * Check if workflows are configured and would be triggered for PRs to the target branch
 * Returns detailed information about workflow configuration
 */
export const checkWorkflowConfiguration = async (targetBranch: string = 'main', cwd?: string): Promise<{
    hasWorkflows: boolean;
    workflowCount: number;
    hasPullRequestTriggers: boolean;
    triggeredWorkflowNames: string[];
    warning?: string;
}> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.debug(`Checking workflow configuration for PRs to ${targetBranch}...`);

        const response = await octokit.actions.listRepoWorkflows({
            owner,
            repo,
        });

        const workflows = response.data.workflows;

        if (workflows.length === 0) {
            return {
                hasWorkflows: false,
                workflowCount: 0,
                hasPullRequestTriggers: false,
                triggeredWorkflowNames: [],
                warning: 'No GitHub Actions workflows are configured in this repository'
            };
        }

        // Check each workflow to see if it would be triggered by a PR
        const triggeredWorkflows: string[] = [];

        for (const workflow of workflows) {
            try {
                const workflowPath = workflow.path;
                logger.debug(`Checking workflow: ${workflow.name} (${workflowPath})`);

                const contentResponse = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: workflowPath,
                });

                if ('content' in contentResponse.data && contentResponse.data.type === 'file') {
                    const content = Buffer.from(contentResponse.data.content, 'base64').toString('utf-8');

                    if (isTriggeredByPullRequest(content, targetBranch, workflow.name)) {
                        logger.debug(`✓ Workflow "${workflow.name}" will be triggered by PRs to ${targetBranch}`);
                        triggeredWorkflows.push(workflow.name);
                    } else {
                        logger.debug(`✗ Workflow "${workflow.name}" will not be triggered by PRs to ${targetBranch}`);
                    }
                }
            } catch (error: any) {
                logger.debug(`Failed to analyze workflow ${workflow.name}: ${error.message}`);
            }
        }

        const hasPullRequestTriggers = triggeredWorkflows.length > 0;
        const warning = !hasPullRequestTriggers
            ? `${workflows.length} workflow(s) are configured, but none appear to trigger on pull requests to ${targetBranch}`
            : undefined;

        return {
            hasWorkflows: true,
            workflowCount: workflows.length,
            hasPullRequestTriggers,
            triggeredWorkflowNames: triggeredWorkflows,
            warning
        };
    } catch (error: any) {
        logger.debug(`Failed to check workflow configuration: ${error.message}`);
        // If we can't check, assume workflows might exist to avoid false negatives
        return {
            hasWorkflows: true,
            workflowCount: -1,
            hasPullRequestTriggers: true,
            triggeredWorkflowNames: [],
        };
    }
};

/**
 * Check if a workflow is triggered by pull requests to a specific branch
 */
const isTriggeredByPullRequest = (workflowContent: string, targetBranch: string, workflowName: string): boolean => {
    const logger = getLogger();

    try {
        // Look for pull_request trigger with branch patterns
        // Pattern 1: on.pull_request (with or without branch filters)
        // on:
        //   pull_request:
        //     branches: [main, develop, ...]
        const prEventPattern = /(?:^|\r?\n)[^\S\r\n]*on\s*:\s*\r?\n(?:[^\S\r\n]*[^\r\n]+(?:\r?\n))*?[^\S\r\n]*pull_request\s*:/mi;

        // Pattern 2: on: [push, pull_request] or on: pull_request
        const onPullRequestPattern = /(?:^|\n)\s*on\s*:\s*(?:\[.*pull_request.*\]|pull_request)\s*(?:\n|$)/m;

        const hasPullRequestTrigger = prEventPattern.test(workflowContent) || onPullRequestPattern.test(workflowContent);

        if (!hasPullRequestTrigger) {
            return false;
        }

        // If pull_request trigger is found, check if it matches our target branch
        // Look for branch restrictions
        const branchPattern = /pull_request\s*:\s*\r?\n(?:[^\S\r\n]*[^\r\n]+(?:\r?\n))*?[^\S\r\n]*branches\s*:\s*(?:\r?\n|\[)([^\]\r\n]+)/mi;
        const branchMatch = workflowContent.match(branchPattern);

        if (branchMatch) {
            const branchesSection = branchMatch[1];
            logger.debug(`Workflow "${workflowName}" has branch filter: ${branchesSection}`);

            // Check if target branch is explicitly mentioned
            if (branchesSection.includes(targetBranch)) {
                logger.debug(`Workflow "${workflowName}" branch filter matches ${targetBranch} (exact match)`);
                return true;
            }

            // Check for catch-all patterns (** or standalone *)
            // But not patterns like "feature/*" which are specific to a prefix
            if (branchesSection.includes('**') || branchesSection.match(/[[,\s]'?\*'?[,\s\]]/)) {
                logger.debug(`Workflow "${workflowName}" branch filter matches ${targetBranch} (wildcard match)`);
                return true;
            }

            logger.debug(`Workflow "${workflowName}" branch filter does not match ${targetBranch}`);
            return false;
        }

        // If no branch filter is specified, the workflow triggers on all PRs
        logger.debug(`Workflow "${workflowName}" has no branch filter, triggers on all PRs`);
        return true;

    } catch (error: any) {
        logger.debug(`Failed to parse workflow content for ${workflowName}: ${error.message}`);
        // If we can't parse, assume it might trigger to avoid false negatives
        return true;
    }
};

/**
 * Check if any workflow runs have been triggered for a specific PR
 * This is more specific than hasWorkflowsConfigured as it checks for actual runs
 */
const hasWorkflowRunsForPR = async (prNumber: number, cwd?: string): Promise<boolean> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        // Get the PR to find the head SHA
        const pr = await octokit.pulls.get({
            owner,
            repo,
            pull_number: prNumber,
        });

        const headSha = pr.data.head.sha;
        const headRef = pr.data.head.ref;

        // Check for workflow runs triggered by this PR
        const workflowRuns = await octokit.actions.listWorkflowRunsForRepo({
            owner,
            repo,
            head_sha: headSha,
            per_page: 50, // Check recent runs
        });

        // Also check for runs on the branch
        const branchRuns = await octokit.actions.listWorkflowRunsForRepo({
            owner,
            repo,
            branch: headRef,
            per_page: 50,
        });

        const allRuns = [...workflowRuns.data.workflow_runs, ...branchRuns.data.workflow_runs];

        // Filter to runs that match our PR's head SHA or are very recent on the branch
        const relevantRuns = allRuns.filter(run =>
            run.head_sha === headSha ||
            (run.head_branch === headRef && new Date(run.created_at).getTime() > Date.now() - 300000) // Last 5 minutes
        );

        if (relevantRuns.length > 0) {
            logger.debug(`Found ${relevantRuns.length} workflow runs for PR #${prNumber} (SHA: ${headSha})`);
            return true;
        }

        logger.debug(`No workflow runs found for PR #${prNumber} (SHA: ${headSha}, branch: ${headRef})`);
        return false;


    } catch (error: any) {
        logger.debug(`Error checking workflow runs for PR #${prNumber}: ${error.message}`);
        // If we can't check workflow runs, assume they might exist
        return true;
    }
};

export const waitForPullRequestChecks = async (prNumber: number, options: { timeout?: number; skipUserConfirmation?: boolean; cwd?: string } = {}): Promise<void> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(options.cwd);
    const logger = getLogger();
    const timeout = options.timeout || 3600000; // 1 hour default timeout
    const skipUserConfirmation = options.skipUserConfirmation || false;

    const startTime = Date.now();
    let consecutiveNoChecksCount = 0;
    const maxConsecutiveNoChecks = 3; // 3 consecutive checks (30 seconds) with no checks before deeper investigation
    let checkedWorkflowRuns = false; // Track if we've already checked for workflow runs to avoid repeated checks

    while (true) {
        const elapsedTime = Date.now() - startTime;

        // Check for timeout
        if (elapsedTime > timeout) {
            logger.warn(`Timeout reached (${timeout / 1000}s) while waiting for PR #${prNumber} checks.`);

            if (!skipUserConfirmation) {
                const proceedWithoutChecks = await promptConfirmation(
                    `⚠️  Timeout reached while waiting for PR #${prNumber} checks.\n` +
                    `This might indicate that no checks are configured for this repository.\n` +
                    `Do you want to proceed with merging the PR without waiting for checks?`
                );

                if (proceedWithoutChecks) {
                    logger.info('User chose to proceed without waiting for checks.');
                    return;
                } else {
                    throw new Error(`Timeout waiting for PR #${prNumber} checks. User chose not to proceed.`);
                }
            } else {
                throw new Error(`Timeout waiting for PR #${prNumber} checks (${timeout / 1000}s)`);
            }
        }

        const pr = await octokit.pulls.get({
            owner,
            repo,
            pull_number: prNumber,
        });

        const checkRunsResponse = await octokit.checks.listForRef({
            owner,
            repo,
            ref: pr.data.head.sha,
        });

        const checkRuns = checkRunsResponse.data.check_runs;

        if (checkRuns.length === 0) {
            consecutiveNoChecksCount++;
            logger.info(`PR #${prNumber}: No checks found (${consecutiveNoChecksCount}/${maxConsecutiveNoChecks}). Waiting...`);

            // After several consecutive "no checks" responses, check if workflows are configured
            if (consecutiveNoChecksCount >= maxConsecutiveNoChecks) {
                logger.info(`No checks detected for ${maxConsecutiveNoChecks} consecutive attempts. Checking repository configuration...`);

                const hasWorkflows = await hasWorkflowsConfigured(options.cwd);

                if (!hasWorkflows) {
                    logger.warn(`No GitHub Actions workflows found in repository ${owner}/${repo}.`);

                    if (!skipUserConfirmation) {
                        const proceedWithoutChecks = await promptConfirmation(
                            `⚠️  No GitHub Actions workflows or checks are configured for this repository.\n` +
                            `PR #${prNumber} will never have status checks to wait for.\n` +
                            `Do you want to proceed with merging the PR without checks?`
                        );

                        if (proceedWithoutChecks) {
                            logger.info('User chose to proceed without checks (no workflows configured).');
                            return;
                        } else {
                            throw new Error(`No checks configured for PR #${prNumber}. User chose not to proceed.`);
                        }
                    } else {
                        // In non-interactive mode, proceed if no workflows are configured
                        logger.info('No workflows configured, proceeding without checks.');
                        return;
                    }
                } else {
                    // Workflows exist, but check if any are actually running for this PR
                    if (!checkedWorkflowRuns) {
                        logger.info('GitHub Actions workflows are configured. Checking if any workflows are triggered for this PR...');

                        // First check if workflow runs exist at all for this PR's branch/SHA
                        const hasRunsForPR = await hasWorkflowRunsForPR(prNumber, options.cwd);
                        checkedWorkflowRuns = true; // Mark that we've checked

                        if (!hasRunsForPR) {
                            logger.warn(`No workflow runs detected for PR #${prNumber}. This may indicate that the configured workflows don't match this branch pattern.`);

                            if (!skipUserConfirmation) {
                                const proceedWithoutChecks = await promptConfirmation(
                                    `⚠️  GitHub Actions workflows are configured in this repository, but none appear to be triggered by PR #${prNumber}.\n` +
                                    `This usually means the workflow trigger patterns (branches, paths) don't match this PR.\n` +
                                    `PR #${prNumber} will likely never have status checks to wait for.\n` +
                                    `Do you want to proceed with merging the PR without waiting for checks?`
                                );

                                if (proceedWithoutChecks) {
                                    logger.info('User chose to proceed without checks (no matching workflow triggers).');
                                    return;
                                } else {
                                    throw new Error(`No matching workflow triggers for PR #${prNumber}. User chose not to proceed.`);
                                }
                            } else {
                                // In non-interactive mode, proceed if no workflow runs are detected
                                logger.info('No workflow runs detected for this PR, proceeding without checks.');
                                return;
                            }
                        } else {
                            // Workflow runs exist on the branch, but they might not be associated with the PR
                            // This happens when workflows trigger on 'push' but not 'pull_request'
                            logger.info(`Found workflow runs on the branch, but none appear as PR checks.`);
                            logger.info(`This usually means workflows trigger on 'push' but not 'pull_request'.`);

                            if (!skipUserConfirmation) {
                                const proceedWithoutChecks = await promptConfirmation(
                                    `⚠️  Workflow runs exist for the branch, but no check runs are associated with PR #${prNumber}.\n` +
                                    `This typically means workflows are configured for 'push' events but not 'pull_request' events.\n` +
                                    `Do you want to proceed with merging the PR without waiting for checks?`
                                );

                                if (proceedWithoutChecks) {
                                    logger.info('User chose to proceed without PR checks (workflows not configured for pull_request events).');
                                    return;
                                } else {
                                    throw new Error(`No PR check runs for #${prNumber} (workflows trigger on push only). User chose not to proceed.`);
                                }
                            } else {
                                // In non-interactive mode, proceed if workflow runs exist but aren't PR checks
                                logger.info('Workflow runs exist but are not PR checks, proceeding without checks.');
                                return;
                            }
                        }
                    } else {
                        // We've already checked workflow runs and found them on the branch but not as PR checks
                        // At this point, we should give up to avoid infinite loops
                        logger.warn(`Still no checks after ${consecutiveNoChecksCount} attempts. Workflow runs exist on branch but not as PR checks.`);

                        if (!skipUserConfirmation) {
                            const proceedWithoutChecks = await promptConfirmation(
                                `⚠️  After waiting ${Math.round(elapsedTime / 1000)}s, no checks have appeared for PR #${prNumber}.\n` +
                                `The configured workflows don't appear to trigger for this branch.\n` +
                                `Do you want to proceed with merging the PR without checks?`
                            );

                            if (proceedWithoutChecks) {
                                logger.info('User chose to proceed without checks (timeout waiting for workflow triggers).');
                                return;
                            } else {
                                throw new Error(`No workflow triggers matched PR #${prNumber} after waiting. User chose not to proceed.`);
                            }
                        } else {
                            // In non-interactive mode, proceed after reasonable waiting
                            logger.info('No workflow runs detected after waiting, proceeding without checks.');
                            return;
                        }
                    }
                }
            }

            await delay(10000);
            continue;
        }

        // Reset the no-checks counter since we found some checks
        consecutiveNoChecksCount = 0;

        // ... rest of the while loop logic ...
        const failingChecks = checkRuns.filter(
            (cr) => cr.conclusion && ['failure', 'timed_out', 'cancelled'].includes(cr.conclusion)
        );

        if (failingChecks.length > 0) {
            const { owner, repo } = await getRepoDetails(options.cwd);
            const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;

            // Collect detailed information about each failed check
            const detailedFailedChecks = await Promise.all(
                failingChecks.map(async (check) => {
                    try {
                        // Get additional details from the check run
                        const checkDetails = await octokit.checks.get({
                            owner,
                            repo,
                            check_run_id: check.id,
                        });

                        return {
                            name: check.name,
                            conclusion: check.conclusion || 'unknown',
                            detailsUrl: check.details_url || undefined,
                            summary: checkDetails.data.output?.summary || undefined,
                            output: {
                                title: checkDetails.data.output?.title || undefined,
                                summary: checkDetails.data.output?.summary || undefined,
                                text: checkDetails.data.output?.text || undefined,
                            },
                        };
                    } catch {
                        // Fallback to basic information if we can't get details
                        return {
                            name: check.name,
                            conclusion: check.conclusion || 'unknown',
                            detailsUrl: check.details_url || undefined,
                        };
                    }
                })
            );

            logger.error(`❌ PR #${prNumber} has ${failingChecks.length} failing check${failingChecks.length > 1 ? 's' : ''}:`);
            logger.error('');

            for (const check of detailedFailedChecks) {
                const statusIcon = check.conclusion === 'failure' ? '❌' :
                    check.conclusion === 'timed_out' ? '⏰' : '🚫';
                logger.error(`${statusIcon} ${check.name}: ${check.conclusion}`);

                // Show more detailed error information if available
                if (check.output?.title && check.output.title !== check.name) {
                    logger.error(`   Issue: ${check.output.title}`);
                }

                if (check.output?.summary) {
                    // Truncate very long summaries
                    const summary = check.output.summary.length > 200
                        ? check.output.summary.substring(0, 200) + '...'
                        : check.output.summary;
                    logger.error(`   Summary: ${summary}`);
                }

                // Include direct link to check details
                if (check.detailsUrl) {
                    logger.error(`   Details: ${check.detailsUrl}`);
                }
                logger.error('');
            }

            // Import the new error class
            const { PullRequestCheckError } = await import('./errors');

            // Create and throw the enhanced error with detailed recovery instructions
            const prError = new PullRequestCheckError(
                `PR #${prNumber} checks failed. ${failingChecks.length} check${failingChecks.length > 1 ? 's' : ''} failed.`,
                prNumber,
                detailedFailedChecks,
                prUrl
            );

            // Display recovery instructions (split by line to avoid character-by-character logging)
            const instructions = prError.getRecoveryInstructions();
            for (const line of instructions.split('\n')) {
                logger.error(line);
            }
            logger.error('');

            throw prError;
        }

        const allChecksCompleted = checkRuns.every((cr) => cr.status === 'completed');

        if (allChecksCompleted) {
            logger.info(`All checks for PR #${prNumber} have completed successfully.`);
            return;
        }

        const completedCount = checkRuns.filter(cr => cr.status === 'completed').length;
        logger.info(`PR #${prNumber} checks: ${completedCount}/${checkRuns.length} completed. Waiting...`);

        await delay(10000); // wait 10 seconds
    }
};

export const mergePullRequest = async (
    prNumber: number,
    mergeMethod: MergeMethod = 'squash',
    deleteBranch: boolean = true,
    cwd?: string
): Promise<void> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    logger.info(`Merging PR #${prNumber} using ${mergeMethod} method...`);
    const pr = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
    });
    const headBranch = pr.data.head.ref;

    await octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: mergeMethod,
    });
    logger.info(`PR #${prNumber} merged using ${mergeMethod} method.`);

    if (deleteBranch) {
        logger.info(`Deleting branch ${headBranch}...`);
        await octokit.git.deleteRef({
            owner,
            repo,
            ref: `heads/${headBranch}`,
        });
        logger.info(`Branch ${headBranch} deleted.`);
    } else {
        logger.info(`Preserving branch ${headBranch} (deletion skipped).`);
    }
};

export const createRelease = async (tagName: string, title: string, notes: string, cwd?: string): Promise<void> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    logger.info(`Creating release for tag ${tagName}...`);
    await octokit.repos.createRelease({
        owner,
        repo,
        tag_name: tagName,
        name: title,
        body: notes,
    });
    logger.info(`Release ${tagName} created.`);
};

export const getReleaseByTagName = async (tagName: string, cwd?: string): Promise<any> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        const response = await octokit.repos.getReleaseByTag({
            owner,
            repo,
            tag: tagName,
        });

        logger.debug(`Found release for tag ${tagName}: created at ${response.data.created_at}`);
        return response.data;
    } catch (error: any) {
        logger.debug(`Failed to get release for tag ${tagName}: ${error.message}`);
        throw error;
    }
};

export const getOpenIssues = async (limit: number = 20, cwd?: string): Promise<string> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.debug(`Fetching up to ${limit} open GitHub issues...`);

        const response = await octokit.issues.listForRepo({
            owner,
            repo,
            state: 'open',
            per_page: Math.min(limit, 100), // GitHub API limit
            sort: 'updated',
            direction: 'desc',
        });

        const issues = response.data.filter(issue => !issue.pull_request); // Filter out PRs

        if (issues.length === 0) {
            logger.debug('No open issues found');
            return '';
        }

        const issueStrings = issues.slice(0, limit).map(issue => {
            const labels = issue.labels.map(label =>
                typeof label === 'string' ? label : label.name
            ).join(', ');

            return [
                `Issue #${issue.number}: ${issue.title}`,
                `Labels: ${labels || 'none'}`,
                `Created: ${issue.created_at}`,
                `Updated: ${issue.updated_at}`,
                `Body: ${issue.body?.substring(0, 500) || 'No description'}${issue.body && issue.body.length > 500 ? '...' : ''}`,
                '---'
            ].join('\n');
        });

        logger.debug(`Fetched ${issues.length} open issues`);
        return issueStrings.join('\n\n');
    } catch (error: any) {
        logger.warn(`Failed to fetch GitHub issues: ${error.message}`);
        return '';
    }
};

export const createIssue = async (
    title: string,
    body: string,
    labels?: string[],
    cwd?: string
): Promise<{ number: number; html_url: string }> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);

    const response = await octokit.issues.create({
        owner,
        repo,
        title,
        body,
        labels: labels || [],
    });

    return {
        number: response.data.number,
        html_url: response.data.html_url,
    };
};

export const getWorkflowRunsTriggeredByRelease = async (tagName: string, workflowNames?: string[], cwd?: string): Promise<any[]> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.debug(`Fetching workflow runs triggered by release ${tagName}...`);

        // Get release information to filter by creation time and commit SHA
        let releaseInfo: any;
        let releaseCreatedAt: string | undefined;
        let releaseCommitSha: string | undefined;

        try {
            releaseInfo = await getReleaseByTagName(tagName, cwd);
            releaseCreatedAt = releaseInfo?.created_at;
            releaseCommitSha = releaseInfo?.target_commitish;
        } catch (error: any) {
            logger.debug(`Could not get release info for ${tagName}: ${error.message}. Using more permissive filtering.`);
        }

        if (releaseCreatedAt) {
            logger.debug(`Release ${tagName} was created at ${releaseCreatedAt}, filtering workflows created after this time`);
        } else {
            logger.debug(`No release creation time available for ${tagName}, using more permissive time filtering`);
        }

        if (releaseCommitSha) {
            logger.debug(`Release ${tagName} targets commit ${releaseCommitSha}`);
        }

        // Get all workflows
        const workflowsResponse = await octokit.actions.listRepoWorkflows({
            owner,
            repo,
        });

        const relevantWorkflows = workflowsResponse.data.workflows.filter(workflow => {
            // If specific workflow names are provided, only include those
            if (workflowNames && workflowNames.length > 0) {
                return workflowNames.includes(workflow.name);
            }
            // Otherwise, find workflows that trigger on releases
            return true; // We'll filter by event later when we get the runs
        });

        logger.debug(`Found ${relevantWorkflows.length} workflows to check`);

        const allRuns: any[] = [];

        // Get recent workflow runs for each workflow
        for (const workflow of relevantWorkflows) {
            try {
                const runsResponse = await octokit.actions.listWorkflowRuns({
                    owner,
                    repo,
                    workflow_id: workflow.id,
                    per_page: 30, // Check more runs to account for filtering
                });

                logger.debug(`Checking ${runsResponse.data.workflow_runs.length} recent runs for workflow "${workflow.name}"`);

                // Filter runs that were triggered by our specific release
                const releaseRuns = runsResponse.data.workflow_runs.filter(run => {
                    logger.debug(`Evaluating run ${run.id} for workflow "${workflow.name}": event=${run.event}, created_at=${run.created_at}`);

                    // Must have required data
                    if (!run.created_at) {
                        logger.debug(`Excluding workflow run ${run.id}: missing created_at`);
                        return false;
                    }

                    // Simple logic: if we have release info, just check that the run was created after the release
                    if (releaseCreatedAt) {
                        const runCreatedAt = new Date(run.created_at).getTime();
                        const releaseCreatedAtTime = new Date(releaseCreatedAt).getTime();

                        // Include any run that started after the release (with 1 minute buffer for timing)
                        if (runCreatedAt < releaseCreatedAtTime - 60000) {
                            logger.debug(`Excluding workflow run ${run.id}: created before release (run: ${run.created_at}, release: ${releaseCreatedAt})`);
                            return false;
                        }
                    } else {
                        // No release info - just look for recent runs (within last 30 minutes)
                        const runAge = Date.now() - new Date(run.created_at).getTime();
                        if (runAge > 1800000) { // 30 minutes
                            logger.debug(`Excluding old workflow run ${run.id}: created ${run.created_at}`);
                            return false;
                        }
                    }

                    logger.debug(`Including workflow run ${run.id}: ${workflow.name} (${run.status}/${run.conclusion || 'pending'}) created ${run.created_at}`);
                    return true;
                });

                allRuns.push(...releaseRuns);

                if (releaseRuns.length > 0) {
                    logger.debug(`Found ${releaseRuns.length} relevant workflow runs for ${workflow.name}`);
                } else {
                    logger.debug(`No relevant workflow runs found for ${workflow.name}`);
                }
            } catch (error: any) {
                logger.warn(`Failed to get runs for workflow ${workflow.name}: ${error.message}`);
            }
        }

        // Sort by creation time (newest first)
        allRuns.sort((a, b) => {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        logger.debug(`Found ${allRuns.length} workflow runs triggered by release ${tagName}`);
        return allRuns;
    } catch (error: any) {
        logger.error(`Failed to get workflow runs for release ${tagName}: ${error.message}`);
        return [];
    }
};

export const waitForReleaseWorkflows = async (
    tagName: string,
    options: {
        timeout?: number;
        workflowNames?: string[];
        skipUserConfirmation?: boolean;
        cwd?: string;
    } = {}
): Promise<void> => {
    const logger = getLogger();
    const timeout = options.timeout || 1800000; // 30 minutes default
    const skipUserConfirmation = options.skipUserConfirmation || false;

    logger.info(`Waiting for workflows triggered by release ${tagName}...`);

    // Wait for workflows to start (GitHub can take time to process the release and trigger workflows)
    logger.debug('Waiting 20 seconds for workflows to start...');
    await delay(20000);

    const startTime = Date.now();
    let workflowRuns: any[] = [];
    let consecutiveNoWorkflowsCount = 0;
    const maxConsecutiveNoWorkflows = 20;

    while (true) {
        const elapsedTime = Date.now() - startTime;

        // Check for timeout
        if (elapsedTime > timeout) {
            logger.warn(`Timeout reached (${timeout / 1000}s) while waiting for release workflows.`);

            if (!skipUserConfirmation) {
                const proceedWithoutWorkflows = await promptConfirmation(
                    `⚠️  Timeout reached while waiting for release workflows for ${tagName}.\n` +
                    `This might indicate that no workflows are configured to trigger on releases.\n` +
                    `Do you want to proceed anyway?`
                );

                if (proceedWithoutWorkflows) {
                    logger.info('User chose to proceed without waiting for release workflows.');
                    return;
                } else {
                    throw new Error(`Timeout waiting for release workflows for ${tagName}. User chose not to proceed.`);
                }
            } else {
                throw new Error(`Timeout waiting for release workflows for ${tagName} (${timeout / 1000}s)`);
            }
        }

        // Get current workflow runs
        workflowRuns = await getWorkflowRunsTriggeredByRelease(tagName, options.workflowNames, options.cwd);

        if (workflowRuns.length === 0) {
            consecutiveNoWorkflowsCount++;
            logger.info(`No release workflows found (${consecutiveNoWorkflowsCount}/${maxConsecutiveNoWorkflows}). Waiting...`);

            // Add debug info about what we're looking for
            if (consecutiveNoWorkflowsCount === 1) {
                logger.debug(`Looking for workflows triggered by release ${tagName}`);
                if (options.workflowNames && options.workflowNames.length > 0) {
                    logger.debug(`Specific workflows to monitor: ${options.workflowNames.join(', ')}`);
                } else {
                    logger.debug('Monitoring all workflows that might be triggered by releases');
                }
            }

            // After several attempts with no workflows, ask user if they want to continue
            if (consecutiveNoWorkflowsCount >= maxConsecutiveNoWorkflows) {
                logger.warn(`No workflows triggered by release ${tagName} after ${maxConsecutiveNoWorkflows} attempts.`);

                if (!skipUserConfirmation) {
                    const proceedWithoutWorkflows = await promptConfirmation(
                        `⚠️  No GitHub Actions workflows appear to be triggered by the release ${tagName}.\n` +
                        `This might be expected if no workflows are configured for release events.\n` +
                        `Do you want to proceed without waiting for workflows?`
                    );

                    if (proceedWithoutWorkflows) {
                        logger.info('User chose to proceed without release workflows.');
                        return;
                    } else {
                        throw new Error(`No release workflows found for ${tagName}. User chose not to proceed.`);
                    }
                } else {
                    // In non-interactive mode, proceed if no workflows are found
                    logger.info('No release workflows found, proceeding.');
                    return;
                }
            }

            await delay(10000);
            continue;
        }

        // Reset counter since we found workflows
        consecutiveNoWorkflowsCount = 0;

        // Check status of all workflow runs
        const failingRuns = workflowRuns.filter(run =>
            run.conclusion && ['failure', 'timed_out', 'cancelled'].includes(run.conclusion)
        );

        if (failingRuns.length > 0) {
            logger.error(`Release workflows for ${tagName} have failures:`);
            for (const run of failingRuns) {
                logger.error(`- ${run.name}: ${run.conclusion} (${run.html_url})`);
            }
            throw new Error(`Release workflows for ${tagName} failed.`);
        }

        const allWorkflowsCompleted = workflowRuns.every(run => run.status === 'completed');

        if (allWorkflowsCompleted) {
            const successfulRuns = workflowRuns.filter(run => run.conclusion === 'success');
            logger.info(`All ${workflowRuns.length} release workflows for ${tagName} completed successfully.`);
            for (const run of successfulRuns) {
                logger.info(`✓ ${run.name}: ${run.conclusion}`);
            }
            return;
        }

        const completedCount = workflowRuns.filter(run => run.status === 'completed').length;
        const runningCount = workflowRuns.filter(run => run.status === 'in_progress').length;
        const queuedCount = workflowRuns.filter(run => run.status === 'queued').length;

        // Log detailed information about each workflow run being tracked
        if (workflowRuns.length > 0) {
            logger.debug(`Tracking ${workflowRuns.length} workflow runs for release ${tagName}:`);
            workflowRuns.forEach(run => {
                const statusIcon = run.status === 'completed' ?
                    (run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : '⚠️') :
                    run.status === 'in_progress' ? '🔄' : '⏳';
                logger.debug(`  ${statusIcon} ${run.name} (${run.status}${run.conclusion ? `/${run.conclusion}` : ''}) - created ${run.created_at}`);
            });
        }

        logger.info(
            `Release workflows for ${tagName}: ${completedCount} completed, ${runningCount} running, ${queuedCount} queued (${workflowRuns.length} total)`
        );

        await delay(15000); // wait 15 seconds
    }
};

export const getWorkflowsTriggeredByRelease = async (cwd?: string): Promise<string[]> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.debug('Analyzing workflows to find those triggered by release events...');

        // Get all workflows
        const workflowsResponse = await octokit.actions.listRepoWorkflows({
            owner,
            repo,
        });

        const releaseWorkflows: string[] = [];

        // Check each workflow's configuration
        for (const workflow of workflowsResponse.data.workflows) {
            try {
                // Get the workflow file content
                const workflowPath = workflow.path;
                logger.debug(`Analyzing workflow: ${workflow.name} (${workflowPath})`);

                const contentResponse = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: workflowPath,
                });

                // Handle the response - it could be a file or directory
                if ('content' in contentResponse.data && contentResponse.data.type === 'file') {
                    // Decode the base64 content
                    const content = Buffer.from(contentResponse.data.content, 'base64').toString('utf-8');

                    // Parse the YAML to check trigger conditions
                    if (isTriggeredByRelease(content, workflow.name)) {
                        logger.debug(`✓ Workflow "${workflow.name}" will be triggered by release events`);
                        releaseWorkflows.push(workflow.name);
                    } else {
                        logger.debug(`✗ Workflow "${workflow.name}" will not be triggered by release events`);
                    }
                } else {
                    logger.warn(`Could not read content for workflow ${workflow.name}`);
                }
            } catch (error: any) {
                logger.warn(`Failed to analyze workflow ${workflow.name}: ${error.message}`);
            }
        }

        logger.info(`Found ${releaseWorkflows.length} workflows that will be triggered by release events: ${releaseWorkflows.join(', ')}`);
        return releaseWorkflows;
    } catch (error: any) {
        logger.error(`Failed to analyze workflows: ${error.message}`);
        return [];
    }
};

const isTriggeredByRelease = (workflowContent: string, workflowName: string): boolean => {
    const logger = getLogger();

    try {
        // Simple regex-based parsing since we don't want to add a YAML dependency
        // Look for common release trigger patterns

        // Pattern 1: on.release (with or without types)
        // on:
        //   release:
        //     types: [published, created, ...]
        const releaseEventPattern = /(?:^|\n)\s*on\s*:\s*(?:\n|\r\n)(?:\s+[^\S\r\n]+)*(?:\s+release\s*:)/m;

        // Pattern 2: on: [push, release] or on: release
        const onReleasePattern = /(?:^|\n)\s*on\s*:\s*(?:\[.*release.*\]|release)\s*(?:\n|$)/m;

        // Pattern 3: push with tag patterns that look like releases
        // on:
        //   push:
        //     tags:
        //       - 'v*'
        //       - 'release/*'
        const tagPushPattern = /(?:^|\r?\n)[^\S\r\n]*on\s*:\s*\r?\n(?:[^\S\r\n]*[^\r\n]+(?:\r?\n))*?[^\S\r\n]*push\s*:\s*\r?\n(?:[^\S\r\n]*tags\s*:\s*(?:\r?\n|\[)[^\]\r\n]*(?:v\*|release|tag)[^\]\r\n]*)/mi;

        const isTriggered = releaseEventPattern.test(workflowContent) ||
                           onReleasePattern.test(workflowContent) ||
                           tagPushPattern.test(workflowContent);

        if (isTriggered) {
            logger.debug(`Workflow "${workflowName}" trigger patterns detected in content`);
        }

        return isTriggered;
    } catch (error: any) {
        logger.warn(`Failed to parse workflow content for ${workflowName}: ${error.message}`);
        return false;
    }
};

// Milestone Management Functions

export const findMilestoneByTitle = async (title: string, cwd?: string): Promise<any | null> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.debug(`Searching for milestone: ${title}`);

        const response = await octokit.issues.listMilestones({
            owner,
            repo,
            state: 'all',
            per_page: 100,
        });

        const milestone = response.data.find(m => m.title === title);

        if (milestone) {
            logger.debug(`Found milestone: ${milestone.title} (${milestone.state})`);
        } else {
            logger.debug(`Milestone not found: ${title}`);
        }

        return milestone || null;
    } catch (error: any) {
        logger.error(`Failed to search for milestone ${title}: ${error.message}`);
        throw error;
    }
};

export const createMilestone = async (title: string, description?: string, cwd?: string): Promise<any> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.info(`Creating milestone: ${title}`);

        const response = await octokit.issues.createMilestone({
            owner,
            repo,
            title,
            description,
        });

        logger.info(`✅ Milestone created: ${title} (#${response.data.number})`);
        return response.data;
    } catch (error: any) {
        logger.error(`Failed to create milestone ${title}: ${error.message}`);
        throw error;
    }
};

export const closeMilestone = async (milestoneNumber: number, cwd?: string): Promise<void> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.info(`Closing milestone #${milestoneNumber}...`);

        await octokit.issues.updateMilestone({
            owner,
            repo,
            milestone_number: milestoneNumber,
            state: 'closed',
        });

        logger.info(`✅ Milestone #${milestoneNumber} closed`);
    } catch (error: any) {
        logger.error(`Failed to close milestone #${milestoneNumber}: ${error.message}`);
        throw error;
    }
};

export const getOpenIssuesForMilestone = async (milestoneNumber: number, cwd?: string): Promise<any[]> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.debug(`Getting open issues for milestone #${milestoneNumber}`);

        const response = await octokit.issues.listForRepo({
            owner,
            repo,
            state: 'open',
            milestone: milestoneNumber.toString(),
            per_page: 100,
        });

        const issues = response.data.filter(issue => !issue.pull_request); // Filter out PRs

        logger.debug(`Found ${issues.length} open issues for milestone #${milestoneNumber}`);
        return issues;
    } catch (error: any) {
        logger.error(`Failed to get issues for milestone #${milestoneNumber}: ${error.message}`);
        throw error;
    }
};

export const moveIssueToMilestone = async (issueNumber: number, milestoneNumber: number, cwd?: string): Promise<void> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.debug(`Moving issue #${issueNumber} to milestone #${milestoneNumber}`);

        await octokit.issues.update({
            owner,
            repo,
            issue_number: issueNumber,
            milestone: milestoneNumber,
        });

        logger.debug(`✅ Issue #${issueNumber} moved to milestone #${milestoneNumber}`);
    } catch (error: any) {
        logger.error(`Failed to move issue #${issueNumber} to milestone #${milestoneNumber}: ${error.message}`);
        throw error;
    }
};

export const moveOpenIssuesToNewMilestone = async (fromMilestoneNumber: number, toMilestoneNumber: number, cwd?: string): Promise<number> => {
    const logger = getLogger();

    try {
        const openIssues = await getOpenIssuesForMilestone(fromMilestoneNumber, cwd);

        if (openIssues.length === 0) {
            logger.debug(`No open issues to move from milestone #${fromMilestoneNumber}`);
            return 0;
        }

        logger.info(`Moving ${openIssues.length} open issues from milestone #${fromMilestoneNumber} to #${toMilestoneNumber}`);

        for (const issue of openIssues) {
            await moveIssueToMilestone(issue.number, toMilestoneNumber, cwd);
        }

        logger.info(`✅ Moved ${openIssues.length} issues to new milestone`);
        return openIssues.length;
    } catch (error: any) {
        logger.error(`Failed to move issues between milestones: ${error.message}`);
        throw error;
    }
};

export const ensureMilestoneForVersion = async (version: string, fromVersion?: string, cwd?: string): Promise<void> => {
    const logger = getLogger();

    try {
        const milestoneTitle = `release/${version}`;
        logger.debug(`Ensuring milestone exists: ${milestoneTitle}`);

        // Check if milestone already exists
        let milestone = await findMilestoneByTitle(milestoneTitle, cwd);

        if (milestone) {
            logger.info(`✅ Milestone already exists: ${milestoneTitle}`);
            return;
        }

        // Create new milestone
        milestone = await createMilestone(milestoneTitle, `Release ${version}`, cwd);

        // If we have a previous version, move open issues from its milestone
        if (fromVersion) {
            const previousMilestoneTitle = `release/${fromVersion}`;
            const previousMilestone = await findMilestoneByTitle(previousMilestoneTitle, cwd);

            if (previousMilestone && previousMilestone.state === 'closed') {
                const movedCount = await moveOpenIssuesToNewMilestone(previousMilestone.number, milestone.number, cwd);
                if (movedCount > 0) {
                    logger.info(`📋 Moved ${movedCount} open issues from ${previousMilestoneTitle} to ${milestoneTitle}`);
                }
            }
        }
    } catch (error: any) {
        // Don't fail the whole operation if milestone management fails
        logger.warn(`⚠️ Milestone management failed (continuing): ${error.message}`);
    }
};

export const closeMilestoneForVersion = async (version: string, cwd?: string): Promise<void> => {
    const logger = getLogger();

    try {
        const milestoneTitle = `release/${version}`;
        logger.debug(`Closing milestone: ${milestoneTitle}`);

        const milestone = await findMilestoneByTitle(milestoneTitle, cwd);

        if (!milestone) {
            logger.debug(`Milestone not found: ${milestoneTitle}`);
            return;
        }

        if (milestone.state === 'closed') {
            logger.debug(`Milestone already closed: ${milestoneTitle}`);
            return;
        }

        await closeMilestone(milestone.number, cwd);
        logger.info(`🏁 Closed milestone: ${milestoneTitle}`);
    } catch (error: any) {
        // Don't fail the whole operation if milestone management fails
        logger.warn(`⚠️ Failed to close milestone (continuing): ${error.message}`);
    }
};

export const getClosedIssuesForMilestone = async (milestoneNumber: number, limit: number = 50, cwd?: string): Promise<any[]> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.debug(`Getting closed issues for milestone #${milestoneNumber}`);

        const response = await octokit.issues.listForRepo({
            owner,
            repo,
            state: 'closed',
            milestone: milestoneNumber.toString(),
            per_page: Math.min(limit, 100),
            sort: 'updated',
            direction: 'desc',
        });

        // Filter out PRs and only include issues closed as completed
        const issues = response.data.filter(issue =>
            !issue.pull_request &&
            issue.state_reason === 'completed'
        );

        logger.debug(`Found ${issues.length} closed issues for milestone #${milestoneNumber}`);
        return issues;
    } catch (error: any) {
        logger.error(`Failed to get closed issues for milestone #${milestoneNumber}: ${error.message}`);
        throw error;
    }
};

export const getIssueDetails = async (issueNumber: number, maxTokens: number = 20000, cwd?: string): Promise<any> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.debug(`Getting details for issue #${issueNumber}`);

        // Get the issue
        const issueResponse = await octokit.issues.get({
            owner,
            repo,
            issue_number: issueNumber,
        });

        const issue = issueResponse.data;
        const content = {
            title: issue.title,
            body: issue.body || '',
            comments: [] as any[],
            totalTokens: 0
        };

        // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
        const estimateTokens = (text: string) => Math.ceil(text.length / 4);

        let currentTokens = estimateTokens(content.title + content.body);
        content.totalTokens = currentTokens;

        // If we're already at or near the limit with just title and body, return now
        if (currentTokens >= maxTokens * 0.9) {
            logger.debug(`Issue #${issueNumber} title/body already uses ${currentTokens} tokens, skipping comments`);
            return content;
        }

        // Get comments
        try {
            const commentsResponse = await octokit.issues.listComments({
                owner,
                repo,
                issue_number: issueNumber,
                per_page: 100,
            });

            for (const comment of commentsResponse.data) {
                const commentTokens = estimateTokens(comment.body || '');

                if (currentTokens + commentTokens > maxTokens) {
                    logger.debug(`Stopping at comment to stay under ${maxTokens} token limit for issue #${issueNumber}`);
                    break;
                }

                content.comments.push({
                    author: comment.user?.login,
                    body: comment.body,
                    created_at: comment.created_at,
                });

                currentTokens += commentTokens;
            }
        } catch (error: any) {
            logger.debug(`Failed to get comments for issue #${issueNumber}: ${error.message}`);
        }

        content.totalTokens = currentTokens;
        logger.debug(`Issue #${issueNumber} details: ${currentTokens} tokens`);

        return content;
    } catch (error: any) {
        logger.error(`Failed to get details for issue #${issueNumber}: ${error.message}`);
        throw error;
    }
};

export const getMilestoneIssuesForRelease = async (versions: string[], maxTotalTokens: number = 50000, cwd?: string): Promise<string> => {
    const logger = getLogger();

    try {
        const allIssues: any[] = [];
        const processedVersions: string[] = [];

        for (const version of versions) {
            const milestoneTitle = `release/${version}`;
            logger.debug(`Looking for milestone: ${milestoneTitle}`);

            const milestone = await findMilestoneByTitle(milestoneTitle, cwd);

            if (!milestone) {
                logger.debug(`Milestone not found: ${milestoneTitle}`);
                continue;
            }

            const issues = await getClosedIssuesForMilestone(milestone.number, 50, cwd);
            if (issues.length > 0) {
                allIssues.push(...issues.map(issue => ({ ...issue, version })));
                processedVersions.push(version);
                logger.info(`📋 Found ${issues.length} closed issues in milestone ${milestoneTitle}`);
            }
        }

        if (allIssues.length === 0) {
            logger.debug('No closed issues found in any milestones');
            return '';
        }

        // Sort issues by updated date (most recent first)
        allIssues.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

        logger.info(`📋 Processing ${allIssues.length} issues for release notes (max ${maxTotalTokens} tokens)`);

        let releaseNotesContent = '';
        let totalTokens = 0;
        const estimateTokens = (text: string) => Math.ceil(text.length / 4);

        // Add header
        const header = `## Issues Resolved\n\nThe following issues were resolved in this release:\n\n`;
        releaseNotesContent += header;
        totalTokens += estimateTokens(header);

        for (const issue of allIssues) {
            // Get detailed issue content with individual token limit
            const issueDetails = await getIssueDetails(issue.number, 20000, cwd);

            // Create issue section
            let issueSection = `### #${issue.number}: ${issueDetails.title}\n\n`;

            if (issueDetails.body) {
                issueSection += `**Description:**\n${issueDetails.body}\n\n`;
            }

            if (issueDetails.comments.length > 0) {
                issueSection += `**Key Discussion Points:**\n`;
                for (const comment of issueDetails.comments) {
                    issueSection += `- **${comment.author}**: ${comment.body}\n`;
                }
                issueSection += '\n';
            }

            // Add labels if present
            if (issue.labels && issue.labels.length > 0) {
                const labelNames = issue.labels.map((label: any) =>
                    typeof label === 'string' ? label : label.name
                ).join(', ');
                issueSection += `**Labels:** ${labelNames}\n\n`;
            }

            issueSection += '---\n\n';

            const sectionTokens = estimateTokens(issueSection);

            // Check if adding this issue would exceed the total limit
            if (totalTokens + sectionTokens > maxTotalTokens) {
                logger.info(`Stopping at issue #${issue.number} to stay under ${maxTotalTokens} token limit`);
                break;
            }

            releaseNotesContent += issueSection;
            totalTokens += sectionTokens;

            logger.debug(`Added issue #${issue.number} (${sectionTokens} tokens, total: ${totalTokens})`);
        }

        logger.info(`📋 Generated release notes from milestone issues (${totalTokens} tokens)`);
        return releaseNotesContent;

    } catch (error: any) {
        // Don't fail the whole operation if milestone content fails
        logger.warn(`⚠️ Failed to get milestone issues for release notes (continuing): ${error.message}`);
        return '';
    }
};

/**
 * Get recently closed GitHub issues for commit message context.
 * Prioritizes issues from milestones that match the current version.
 */
export const getRecentClosedIssuesForCommit = async (currentVersion?: string, limit: number = 10, cwd?: string): Promise<string> => {
    const octokit = getOctokit();
    const { owner, repo } = await getRepoDetails(cwd);
    const logger = getLogger();

    try {
        logger.debug(`Fetching up to ${limit} recently closed GitHub issues for commit context...`);

        // Get recently closed issues
        const response = await octokit.issues.listForRepo({
            owner,
            repo,
            state: 'closed',
            per_page: Math.min(limit, 100), // GitHub API limit
            sort: 'updated',
            direction: 'desc',
        });

        const issues = response.data.filter(issue =>
            !issue.pull_request && // Filter out PRs
            issue.state_reason === 'completed' // Only issues closed as completed
        );

        if (issues.length === 0) {
            logger.debug('No recently closed issues found');
            return '';
        }

        // Determine relevant milestone if we have a current version
        let relevantMilestone: any = null;
        if (currentVersion) {
            // Extract base version for milestone matching (e.g., "0.1.1" from "0.1.1-dev.0")
            const baseVersion = currentVersion.includes('-dev.')
                ? currentVersion.split('-')[0]
                : currentVersion;

            const milestoneTitle = `release/${baseVersion}`;
            relevantMilestone = await findMilestoneByTitle(milestoneTitle, cwd);

            if (relevantMilestone) {
                logger.debug(`Found relevant milestone: ${milestoneTitle}`);
            } else {
                logger.debug(`No milestone found for version: ${baseVersion}`);
            }
        }

        // Categorize issues by relevance
        const milestoneIssues: any[] = [];
        const otherIssues: any[] = [];

        for (const issue of issues.slice(0, limit)) {
            if (relevantMilestone && issue.milestone?.number === relevantMilestone.number) {
                milestoneIssues.push(issue);
            } else {
                otherIssues.push(issue);
            }
        }

        // Build the content, prioritizing milestone issues
        const issueStrings: string[] = [];

        // Add milestone issues first (these are most relevant)
        if (milestoneIssues.length > 0) {
            issueStrings.push(`## Recent Issues from Current Milestone (${relevantMilestone.title}):`);
            milestoneIssues.forEach(issue => {
                const labels = issue.labels.map((label: any) =>
                    typeof label === 'string' ? label : label.name
                ).join(', ');

                issueStrings.push([
                    `Issue #${issue.number}: ${issue.title}`,
                    `Labels: ${labels || 'none'}`,
                    `Closed: ${issue.closed_at}`,
                    `Body: ${issue.body?.substring(0, 300) || 'No description'}${issue.body && issue.body.length > 300 ? '...' : ''}`,
                    '---'
                ].join('\n'));
            });
        }

        // Add other recent issues if we have space
        const remainingLimit = limit - milestoneIssues.length;
        if (otherIssues.length > 0 && remainingLimit > 0) {
            if (milestoneIssues.length > 0) {
                issueStrings.push('\n## Other Recent Closed Issues:');
            }

            otherIssues.slice(0, remainingLimit).forEach(issue => {
                const labels = issue.labels.map((label: any) =>
                    typeof label === 'string' ? label : label.name
                ).join(', ');

                const milestoneInfo = issue.milestone
                    ? `Milestone: ${issue.milestone.title}`
                    : 'Milestone: none';

                issueStrings.push([
                    `Issue #${issue.number}: ${issue.title}`,
                    `Labels: ${labels || 'none'}`,
                    milestoneInfo,
                    `Closed: ${issue.closed_at}`,
                    `Body: ${issue.body?.substring(0, 300) || 'No description'}${issue.body && issue.body.length > 300 ? '...' : ''}`,
                    '---'
                ].join('\n'));
            });
        }

        const totalRelevantIssues = milestoneIssues.length;
        const totalOtherIssues = Math.min(otherIssues.length, remainingLimit);

        logger.debug(`Fetched ${totalRelevantIssues + totalOtherIssues} closed issues (${totalRelevantIssues} from relevant milestone, ${totalOtherIssues} others)`);

        return issueStrings.join('\n\n');
    } catch (error: any) {
        logger.warn(`Failed to fetch recent closed GitHub issues: ${error.message}`);
        return '';
    }
};
