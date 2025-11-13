import { getLogger } from './logger';
import { getOpenIssues, createIssue } from './github';

import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import fs from 'fs/promises';

export interface Issue {
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high';
    category: 'ui' | 'content' | 'functionality' | 'accessibility' | 'performance' | 'other';
    suggestions?: string[];
}

export interface ReviewResult {
    summary: string;
    totalIssues: number;
    issues: Issue[];
}

// Get GitHub issues content
export const get = async (options: { limit?: number } = {}): Promise<string> => {
    const logger = getLogger();
    const { limit = 20 } = options;

    try {
        logger.debug('Fetching open GitHub issues...');
        const issuesLimit = Math.min(limit, 20); // Cap at 20
        const githubIssues = await getOpenIssues(issuesLimit);

        if (githubIssues.trim()) {
            logger.debug(`Added GitHub issues to context (${githubIssues.length} characters)`);
            return githubIssues;
        } else {
            logger.debug('No open GitHub issues found');
            return '';
        }
    } catch (error: any) {
        logger.warn(`Failed to fetch GitHub issues: ${error.message}`);
        return '';
    }
};

// Helper function to get user choice interactively
async function getUserChoice(_prompt: string, _choices: Array<{ key: string, label: string }>): Promise<string> {
    // Placeholder - always returns first choice
    return _choices[0]?.key || '';
}

// Helper function to serialize issue to structured text format
function serializeIssue(issue: Issue): string {
    const lines = [
        '# Issue Editor',
        '',
        '# Edit the issue details below. Lines starting with "#" are comments and will be ignored.',
        '# Valid priorities: low, medium, high',
        '# Valid categories: ui, content, functionality, accessibility, performance, other',
        '# Suggestions should be one per line, preceded by a "-" or "•"',
        '',
        `Title: ${issue.title}`,
        '',
        `Priority: ${issue.priority}`,
        '',
        `Category: ${issue.category}`,
        '',
        'Description:',
        issue.description,
        '',
        'Suggestions:',
    ];

    if (issue.suggestions && issue.suggestions.length > 0) {
        issue.suggestions.forEach(suggestion => {
            lines.push(`- ${suggestion}`);
        });
    } else {
        lines.push('# Add suggestions here, one per line with "-" or "•"');
    }

    return lines.join('\n');
}

// Helper function to deserialize issue from structured text format
function deserializeIssue(content: string): Issue {
    const lines = content.split('\n');

    // Parse the structured format
    let title = '';
    let priority: 'low' | 'medium' | 'high' = 'medium';
    let category: 'ui' | 'content' | 'functionality' | 'accessibility' | 'performance' | 'other' = 'other';
    let description = '';
    const suggestions: string[] = [];

    let currentSection = '';
    let descriptionLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Skip comment lines
        if (line.startsWith('#')) {
            continue;
        }

        // Parse field lines
        if (line.startsWith('Title:')) {
            title = line.substring(6).trim();
        } else if (line.startsWith('Priority:')) {
            const priorityValue = line.substring(9).trim().toLowerCase();
            if (priorityValue === 'low' || priorityValue === 'medium' || priorityValue === 'high') {
                priority = priorityValue;
            }
        } else if (line.startsWith('Category:')) {
            const categoryValue = line.substring(9).trim().toLowerCase();
            if (['ui', 'content', 'functionality', 'accessibility', 'performance', 'other'].includes(categoryValue)) {
                category = categoryValue as any;
            }
        } else if (line === 'Description:') {
            currentSection = 'description';
            descriptionLines = [];
        } else if (line === 'Suggestions:') {
            currentSection = 'suggestions';
            // Process accumulated description lines
            description = descriptionLines.join('\n').trim();
        } else if (currentSection === 'description' && line !== '') {
            descriptionLines.push(lines[i]); // Keep original line with spacing
        } else if (currentSection === 'suggestions' && line !== '') {
            // Parse suggestion line
            const suggestionLine = line.replace(/^[-•]\s*/, '').trim();
            if (suggestionLine) {
                suggestions.push(suggestionLine);
            }
        }
    }

    // If we didn't encounter suggestions section, description might still be accumulating
    if (currentSection === 'description') {
        description = descriptionLines.join('\n').trim();
    }

    return {
        title: title || 'Untitled Issue',
        priority,
        category,
        description: description || 'No description provided',
        suggestions: suggestions.length > 0 ? suggestions : undefined
    };
}

// Helper function to edit issue using editor
async function editIssueInteractively(issue: Issue): Promise<Issue> {
    const logger = getLogger();
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi';

    // Create a temporary file for the user to edit
    const tmpDir = os.tmpdir();
    const tmpFilePath = path.join(tmpDir, `kodrdriv_issue_${Date.now()}.txt`);

    // Serialize the issue to structured text format
    const issueContent = serializeIssue(issue);

    await fs.writeFile(tmpFilePath, issueContent, 'utf8');

    logger.info(`📝 Opening ${editor} to edit issue...`);

    // Open the editor synchronously so execution resumes after the user closes it
    const result = spawnSync(editor, [tmpFilePath], { stdio: 'inherit' });

    if (result.error) {
        throw new Error(`Failed to launch editor '${editor}': ${result.error.message}`);
    }

    // Read the file back and deserialize it
    const editedContent = await fs.readFile(tmpFilePath, 'utf8');

    // Clean up the temporary file with proper error handling
    try {
        await fs.unlink(tmpFilePath);
    } catch (error: any) {
        // Only log if it's not a "file not found" error
        if (error.code !== 'ENOENT') {
            logger.warn(`Failed to cleanup temporary file ${tmpFilePath}: ${error.message}`);
        }
    }

    // Deserialize the edited content back to an Issue object
    const editedIssue = deserializeIssue(editedContent);

    logger.info('✅ Issue updated successfully');
    logger.debug(`Updated issue: ${JSON.stringify(editedIssue, null, 2)}`);

    return editedIssue;
}

// Helper function to format issue body for GitHub
function formatIssueBody(issue: Issue): string {
    let body = `## Description\n\n${issue.description}\n\n`;

    body += `## Details\n\n`;
    body += `- **Priority:** ${issue.priority}\n`;
    body += `- **Category:** ${issue.category}\n`;
    body += `- **Source:** Review\n\n`;

    if (issue.suggestions && issue.suggestions.length > 0) {
        body += `## Suggestions\n\n`;
        issue.suggestions.forEach(suggestion => {
            body += `- ${suggestion}\n`;
        });
        body += '\n';
    }

    body += `---\n\n`;
    body += `*This issue was automatically created from a review session.*`;

    return body;
}

// Helper function to format results with created GitHub issues
function formatReviewResultsWithIssues(
    result: ReviewResult,
    createdIssues: Array<{ issue: Issue, githubUrl: string, number: number }>
): string {
    let output = `📝 Review Results\n\n`;
    output += `📋 Summary: ${result.summary}\n`;
    output += `📊 Total Issues Found: ${result.totalIssues}\n`;
    output += `🚀 GitHub Issues Created: ${createdIssues.length}\n\n`;

    if (result.issues && result.issues.length > 0) {
        output += `📝 Issues Identified:\n\n`;

        result.issues.forEach((issue, index) => {
            const priorityEmoji = issue.priority === 'high' ? '🔴' :
                issue.priority === 'medium' ? '🟡' : '🟢';
            const categoryEmoji = issue.category === 'ui' ? '🎨' :
                issue.category === 'content' ? '📝' :
                    issue.category === 'functionality' ? '⚙️' :
                        issue.category === 'accessibility' ? '♿' :
                            issue.category === 'performance' ? '⚡' : '🔧';

            output += `${index + 1}. ${priorityEmoji} ${issue.title}\n`;
            output += `   ${categoryEmoji} Category: ${issue.category} | Priority: ${issue.priority}\n`;
            output += `   📖 Description: ${issue.description}\n`;

            // Check if this issue was created as a GitHub issue
            const createdIssue = createdIssues.find(ci => ci.issue === issue);
            if (createdIssue) {
                output += `   🔗 GitHub Issue: #${createdIssue.number} - ${createdIssue.githubUrl}\n`;
            }

            if (issue.suggestions && issue.suggestions.length > 0) {
                output += `   💡 Suggestions:\n`;
                issue.suggestions.forEach(suggestion => {
                    output += `      • ${suggestion}\n`;
                });
            }
            output += `\n`;
        });
    } else {
        output += `✅ No specific issues identified from the review.\n\n`;
    }

    if (createdIssues.length > 0) {
        output += `\n🎯 Created GitHub Issues:\n`;
        createdIssues.forEach(createdIssue => {
            output += `• #${createdIssue.number}: ${createdIssue.issue.title} - ${createdIssue.githubUrl}\n`;
        });
        output += `\n`;
    }

    output += `🚀 Next Steps: Review the created GitHub issues and prioritize them in your development workflow.`;

    return output;
}

function formatReviewResults(result: ReviewResult): string {
    let output = `📝 Review Results\n\n`;
    output += `📋 Summary: ${result.summary}\n`;
    output += `📊 Total Issues Found: ${result.totalIssues}\n\n`;

    if (result.issues && result.issues.length > 0) {
        output += `📝 Issues Identified:\n\n`;

        result.issues.forEach((issue, index) => {
            const priorityEmoji = issue.priority === 'high' ? '🔴' :
                issue.priority === 'medium' ? '🟡' : '🟢';
            const categoryEmoji = issue.category === 'ui' ? '🎨' :
                issue.category === 'content' ? '📝' :
                    issue.category === 'functionality' ? '⚙️' :
                        issue.category === 'accessibility' ? '♿' :
                            issue.category === 'performance' ? '⚡' : '🔧';

            output += `${index + 1}. ${priorityEmoji} ${issue.title}\n`;
            output += `   ${categoryEmoji} Category: ${issue.category} | Priority: ${issue.priority}\n`;
            output += `   📖 Description: ${issue.description}\n`;

            if (issue.suggestions && issue.suggestions.length > 0) {
                output += `   💡 Suggestions:\n`;
                issue.suggestions.forEach(suggestion => {
                    output += `      • ${suggestion}\n`;
                });
            }
            output += `\n`;
        });
    } else {
        output += `✅ No specific issues identified from the review.\n\n`;
    }

    output += `🚀 Next Steps: Review the identified issues and prioritize them for your development workflow.`;

    return output;
}

// Handle GitHub issue creation workflow
export const handleIssueCreation = async (
    result: ReviewResult,
    senditMode: boolean = false
): Promise<string> => {
    const logger = getLogger();
    const createdIssues: Array<{ issue: Issue, githubUrl: string, number: number }> = [];

    if (!result.issues || result.issues.length === 0) {
        return formatReviewResults(result);
    }

    logger.info(`🔍 Found ${result.issues.length} issues to potentially create as GitHub issues`);

    for (let i = 0; i < result.issues.length; i++) {
        let issue = result.issues[i];
        let shouldCreateIssue = senditMode;

        if (!senditMode) {
            // Interactive confirmation for each issue - keep looping until user decides
            let userChoice = '';
            while (userChoice !== 'c' && userChoice !== 's') {
                // Display issue details
                logger.info(`\n📋 Issue ${i + 1} of ${result.issues.length}:`);
                logger.info(`   Title: ${issue.title}`);
                logger.info(`   Priority: ${issue.priority} | Category: ${issue.category}`);
                logger.info(`   Description: ${issue.description}`);
                if (issue.suggestions && issue.suggestions.length > 0) {
                    logger.info(`   Suggestions: ${issue.suggestions.join(', ')}`);
                }

                // Get user choice
                userChoice = await getUserChoice('\nWhat would you like to do with this issue?', [
                    { key: 'c', label: 'Create GitHub issue' },
                    { key: 's', label: 'Skip this issue' },
                    { key: 'e', label: 'Edit issue details' }
                ]);

                if (userChoice === 'c') {
                    shouldCreateIssue = true;
                } else if (userChoice === 'e') {
                    // Allow user to edit the issue
                    issue = await editIssueInteractively(issue);
                    result.issues[i] = issue; // Update the issue in the result
                    // Continue the loop to show the updated issue and ask again
                }
                // If choice is 's', loop will exit and shouldCreateIssue remains false
            }
        }

        if (shouldCreateIssue) {
            try {
                logger.info(`🚀 Creating GitHub issue: "${issue.title}"`);

                // Format issue body with additional details
                const issueBody = formatIssueBody(issue);

                // Create labels based on priority and category
                const labels = [
                    `priority-${issue.priority}`,
                    `category-${issue.category}`,
                    'review'
                ];

                const createdIssue = await createIssue(issue.title, issueBody, labels);
                createdIssues.push({
                    issue,
                    githubUrl: createdIssue.html_url,
                    number: createdIssue.number
                });

                logger.info(`✅ Created GitHub issue #${createdIssue.number}: ${createdIssue.html_url}`);
            } catch (error: any) {
                logger.error(`❌ Failed to create GitHub issue for "${issue.title}": ${error.message}`);
            }
        }
    }

    // Return formatted results
    if (createdIssues.length > 0) {
        return formatReviewResultsWithIssues(result, createdIssues);
    } else {
        return formatReviewResults(result);
    }
};
