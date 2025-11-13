import { getLogger } from './logger';
import { getOctokit, getRepoDetails } from './github';

// Function to truncate overly large content while preserving structure
const truncateContent = (content: string, maxLength: number = 3000): string => {
    if (content.length <= maxLength) {
        return content;
    }

    const lines = content.split('\n');
    const truncatedLines: string[] = [];
    let currentLength = 0;

    for (const line of lines) {
        if (currentLength + line.length + 1 > maxLength) {
            break;
        }
        truncatedLines.push(line);
        currentLength += line.length + 1; // +1 for newline
    }

    truncatedLines.push('');
    truncatedLines.push(`... [TRUNCATED: Original content was ${content.length} characters, showing first ${currentLength}] ...`);

    return truncatedLines.join('\n');
};

// Function to fetch recent releases from GitHub API
export const findRecentReleaseNotes = async (limit: number): Promise<string[]> => {
    const logger = getLogger();
    const releaseNotes: string[] = [];

    if (limit <= 0) {
        return releaseNotes;
    }

    try {
        const octokit = getOctokit();
        const { owner, repo } = await getRepoDetails();

        logger.debug(`Fetching up to ${limit} recent releases from GitHub...`);

        const response = await octokit.repos.listReleases({
            owner,
            repo,
            per_page: Math.min(limit, 100), // GitHub API limit
        });

        const releases = response.data;

        if (releases.length === 0) {
            logger.debug('No releases found in GitHub repository');
            return releaseNotes;
        }

        for (const release of releases.slice(0, limit)) {
            const releaseContent = [
                `# ${release.name || release.tag_name}`,
                `**Tag:** ${release.tag_name}`,
                `**Published:** ${release.published_at}`,
                release.prerelease ? '**Type:** Pre-release' : '**Type:** Release',
                release.draft ? '**Status:** Draft' : '**Status:** Published',
                '',
                release.body || 'No release notes provided'
            ].join('\n');

            const truncatedContent = truncateContent(releaseContent);
            releaseNotes.push(`=== GitHub Release: ${release.tag_name} ===\n${truncatedContent}`);

            if (truncatedContent.length < releaseContent.length) {
                logger.debug(`Found release ${release.tag_name} (${truncatedContent.length} characters, truncated from ${releaseContent.length})`);
            } else {
                logger.debug(`Found release ${release.tag_name} (${releaseContent.length} characters)`);
            }
        }

        logger.debug(`Fetched ${releaseNotes.length} releases from GitHub`);

    } catch (error: any) {
        logger.warn(`Error fetching releases from GitHub API: ${error.message}`);

        // If we have a GitHub API error, we could fall back to checking for local release notes
        // This maintains some backward compatibility
        logger.debug('Falling back to local RELEASE_NOTES.md file...');
        try {
            const fs = await import('fs/promises');
            const content = await fs.readFile('RELEASE_NOTES.md', 'utf-8');
            if (content.trim()) {
                const truncatedContent = truncateContent(content);
                releaseNotes.push(`=== Local RELEASE_NOTES.md ===\n${truncatedContent}`);
                logger.debug(`Found local release notes (${content.length} characters)`);
            }
        } catch {
            // No local file either, return empty array
            logger.debug('No local RELEASE_NOTES.md file found either');
        }
    }

    return releaseNotes.slice(0, limit);
};

export const get = async (options: { limit?: number } = {}): Promise<string> => {
    const { limit = 3 } = options;
    const releaseNotes = await findRecentReleaseNotes(limit);
    return releaseNotes.join('\n\n');
};
