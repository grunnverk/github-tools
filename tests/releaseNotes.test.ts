import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findRecentReleaseNotes, get } from '../src/releaseNotes';
import * as logging from '../src/logger';
import * as github from '../src/github';

// Mock external dependencies
vi.mock('../src/logger');
vi.mock('../src/github');
vi.mock('fs/promises');

describe('releaseNotes', () => {
    const mockLogger = {
        debug: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        verbose: vi.fn(),
        silly: vi.fn(),
        log: vi.fn(),
        // Add other winston logger properties as needed
        level: 'info',
        levels: {},
        format: {},
        transports: []
    } as any;

    const mockOctokit = {
        repos: {
            listReleases: vi.fn()
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(logging.getLogger).mockReturnValue(mockLogger);
        vi.mocked(github.getOctokit).mockReturnValue(mockOctokit as any);
        vi.mocked(github.getRepoDetails).mockResolvedValue({
            owner: 'testowner',
            repo: 'testrepo'
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('findRecentReleaseNotes', () => {
        it('should return empty array when limit is 0', async () => {
            const result = await findRecentReleaseNotes(0);
            expect(result).toEqual([]);
        });

        it('should return empty array when limit is negative', async () => {
            const result = await findRecentReleaseNotes(-1);
            expect(result).toEqual([]);
        });

        it('should fetch releases from GitHub API successfully', async () => {
            const mockReleases = [
                {
                    name: 'Release 1.0.0',
                    tag_name: 'v1.0.0',
                    published_at: '2023-01-01T00:00:00Z',
                    prerelease: false,
                    draft: false,
                    body: 'Initial release with basic features'
                },
                {
                    name: 'Release 1.1.0',
                    tag_name: 'v1.1.0',
                    published_at: '2023-02-01T00:00:00Z',
                    prerelease: false,
                    draft: false,
                    body: 'Added new features and bug fixes'
                }
            ];

            mockOctokit.repos.listReleases.mockResolvedValue({
                data: mockReleases
            });

            const result = await findRecentReleaseNotes(2);

            expect(result).toHaveLength(2);
            expect(result[0]).toContain('# Release 1.0.0');
            expect(result[0]).toContain('**Tag:** v1.0.0');
            expect(result[0]).toContain('**Published:** 2023-01-01T00:00:00Z');
            expect(result[0]).toContain('**Type:** Release');
            expect(result[0]).toContain('**Status:** Published');
            expect(result[0]).toContain('Initial release with basic features');
            expect(result[1]).toContain('# Release 1.1.0');
            expect(result[1]).toContain('Added new features and bug fixes');

            expect(mockOctokit.repos.listReleases).toHaveBeenCalledWith({
                owner: 'testowner',
                repo: 'testrepo',
                per_page: 2
            });
        });

        it('should handle prerelease and draft releases', async () => {
            const mockReleases = [
                {
                    name: 'Pre-release 2.0.0-beta',
                    tag_name: 'v2.0.0-beta',
                    published_at: '2023-03-01T00:00:00Z',
                    prerelease: true,
                    draft: false,
                    body: 'Beta release for testing'
                },
                {
                    name: 'Draft Release',
                    tag_name: 'v2.0.0-draft',
                    published_at: '2023-03-15T00:00:00Z',
                    prerelease: false,
                    draft: true,
                    body: 'Draft release not yet published'
                }
            ];

            mockOctokit.repos.listReleases.mockResolvedValue({
                data: mockReleases
            });

            const result = await findRecentReleaseNotes(2);

            expect(result[0]).toContain('**Type:** Pre-release');
            expect(result[0]).toContain('**Status:** Published');
            expect(result[1]).toContain('**Type:** Release');
            expect(result[1]).toContain('**Status:** Draft');
        });

        it('should handle release with no name (use tag_name)', async () => {
            const mockReleases = [
                {
                    tag_name: 'v1.0.0',
                    published_at: '2023-01-01T00:00:00Z',
                    prerelease: false,
                    draft: false,
                    body: 'Release with no name'
                }
            ];

            mockOctokit.repos.listReleases.mockResolvedValue({
                data: mockReleases
            });

            const result = await findRecentReleaseNotes(1);

            expect(result[0]).toContain('# v1.0.0');
        });

        it('should handle release with no body', async () => {
            const mockReleases = [
                {
                    name: 'Release 1.0.0',
                    tag_name: 'v1.0.0',
                    published_at: '2023-01-01T00:00:00Z',
                    prerelease: false,
                    draft: false,
                    body: null
                }
            ];

            mockOctokit.repos.listReleases.mockResolvedValue({
                data: mockReleases
            });

            const result = await findRecentReleaseNotes(1);

            expect(result[0]).toContain('No release notes provided');
        });

        it('should truncate long content', async () => {
            const longBody = 'a'.repeat(4000); // Exceeds default 3000 char limit
            const mockReleases = [
                {
                    name: 'Release 1.0.0',
                    tag_name: 'v1.0.0',
                    published_at: '2023-01-01T00:00:00Z',
                    prerelease: false,
                    draft: false,
                    body: longBody
                }
            ];

            mockOctokit.repos.listReleases.mockResolvedValue({
                data: mockReleases
            });

            const result = await findRecentReleaseNotes(1);

            expect(result[0]).toContain('... [TRUNCATED:');
            expect(result[0].length).toBeLessThan(longBody.length);
        });

        it('should return empty array when no releases found', async () => {
            mockOctokit.repos.listReleases.mockResolvedValue({
                data: []
            });

            const result = await findRecentReleaseNotes(5);

            expect(result).toEqual([]);
            expect(mockLogger.debug).toHaveBeenCalledWith('No releases found in GitHub repository');
        });

        it('should limit results to requested limit', async () => {
            const mockReleases = Array.from({ length: 10 }, (_, i) => ({
                name: `Release ${i + 1}.0.0`,
                tag_name: `v${i + 1}.0.0`,
                published_at: `2023-0${(i % 9) + 1}-01T00:00:00Z`,
                prerelease: false,
                draft: false,
                body: `Release ${i + 1} notes`
            }));

            mockOctokit.repos.listReleases.mockResolvedValue({
                data: mockReleases
            });

            const result = await findRecentReleaseNotes(3);

            expect(result).toHaveLength(3);
            expect(result[0]).toContain('# Release 1.0.0');
            expect(result[1]).toContain('# Release 2.0.0');
            expect(result[2]).toContain('# Release 3.0.0');
        });

        it('should respect GitHub API per_page limit of 100', async () => {
            mockOctokit.repos.listReleases.mockResolvedValue({
                data: []
            });

            await findRecentReleaseNotes(150);

            expect(mockOctokit.repos.listReleases).toHaveBeenCalledWith({
                owner: 'testowner',
                repo: 'testrepo',
                per_page: 100
            });
        });

        it('should fall back to local RELEASE_NOTES.md when GitHub API fails', async () => {
            mockOctokit.repos.listReleases.mockRejectedValue(new Error('API Error'));

            // Mock fs/promises
            const mockFs = await import('fs/promises');
            vi.mocked(mockFs.readFile).mockResolvedValue('# Local Release Notes\n\nThis is from local file.');

            const result = await findRecentReleaseNotes(1);

            expect(result).toHaveLength(1);
            expect(result[0]).toContain('=== Local RELEASE_NOTES.md ===');
            expect(result[0]).toContain('# Local Release Notes');
            expect(result[0]).toContain('This is from local file.');
            expect(mockLogger.warn).toHaveBeenCalledWith('Error fetching releases from GitHub API: %s', 'API Error');
            expect(mockLogger.debug).toHaveBeenCalledWith('Falling back to local RELEASE_NOTES.md file...');
        });

        it('should return empty array when both GitHub API and local file fail', async () => {
            mockOctokit.repos.listReleases.mockRejectedValue(new Error('API Error'));

            // Mock fs/promises to fail
            const mockFs = await import('fs/promises');
            vi.mocked(mockFs.readFile).mockRejectedValue(new Error('File not found'));

            const result = await findRecentReleaseNotes(1);

            expect(result).toEqual([]);
            expect(mockLogger.debug).toHaveBeenCalledWith('No local RELEASE_NOTES.md file found either');
        });

        it('should handle empty local file', async () => {
            mockOctokit.repos.listReleases.mockRejectedValue(new Error('API Error'));

            // Mock fs/promises to return empty content
            const mockFs = await import('fs/promises');
            vi.mocked(mockFs.readFile).mockResolvedValue('   \n  \n  ');

            const result = await findRecentReleaseNotes(1);

            expect(result).toEqual([]);
        });
    });

    describe('get', () => {
        it('should return joined release notes with default limit', async () => {
            const mockReleases = [
                {
                    name: 'Release 1.0.0',
                    tag_name: 'v1.0.0',
                    published_at: '2023-01-01T00:00:00Z',
                    prerelease: false,
                    draft: false,
                    body: 'First release'
                },
                {
                    name: 'Release 1.1.0',
                    tag_name: 'v1.1.0',
                    published_at: '2023-02-01T00:00:00Z',
                    prerelease: false,
                    draft: false,
                    body: 'Second release'
                }
            ];

            mockOctokit.repos.listReleases.mockResolvedValue({
                data: mockReleases
            });

            const result = await get();

            expect(result).toContain('# Release 1.0.0');
            expect(result).toContain('# Release 1.1.0');
            expect(result).toContain('First release');
            expect(result).toContain('Second release');

            // Should be joined with double newlines
            const parts = result.split('\n\n');
            expect(parts.length).toBeGreaterThan(2);
        });

        it('should respect custom limit option', async () => {
            const mockReleases = Array.from({ length: 5 }, (_, i) => ({
                name: `Release ${i + 1}.0.0`,
                tag_name: `v${i + 1}.0.0`,
                published_at: `2023-0${(i % 9) + 1}-01T00:00:00Z`,
                prerelease: false,
                draft: false,
                body: `Release ${i + 1} notes`
            }));

            mockOctokit.repos.listReleases.mockResolvedValue({
                data: mockReleases
            });

            const result = await get({ limit: 2 });

            expect(result).toContain('# Release 1.0.0');
            expect(result).toContain('# Release 2.0.0');
            expect(result).not.toContain('# Release 3.0.0');
        });

        it('should return empty string when no releases found', async () => {
            mockOctokit.repos.listReleases.mockResolvedValue({
                data: []
            });

            const result = await get();

            expect(result).toBe('');
        });

        it('should handle limit of 0', async () => {
            const result = await get({ limit: 0 });

            expect(result).toBe('');
        });
    });
});
