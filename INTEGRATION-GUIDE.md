# GitHub Tools Integration Guide for KodrDriv

## Summary

**Package**: `@eldrforge/github-tools@0.1.0-dev.0`
**Status**: ✅ Built and ready for integration
**Location**: `/Users/tobrien/gitw/calenvarek/github-tools`

---

## Installation Complete

```bash
✅ npm install ../github-tools
```

Package is now available in kodrdriv as a local dependency.

---

## Files That Need Updating in KodrDriv

Based on grep analysis, these files import from the extracted modules:

### Files Importing `util/github`:
- `src/commands/development.ts`
- `src/commands/publish.ts`
- `src/commands/release.ts`
- `src/commands/review.ts`
- `src/content/issues.ts` (will be removed)
- `src/content/releaseNotes.ts` (will be removed)

### Files Importing `content/issues`:
- `src/commands/review.ts`
- `src/commands/audio-review.ts`

### Files Importing `content/releaseNotes`:
- `src/commands/release.ts`
- `src/commands/publish.ts`

---

## Step-by-Step Integration Plan

### Step 1: Update Import Statements

**Pattern to Replace:**
```typescript
// OLD
import * as GitHub from '../util/github';
import * as Issues from '../content/issues';
import * as ReleaseNotes from '../content/releaseNotes';

// NEW
import * as GitHub from '@eldrforge/github-tools';
// Issues and ReleaseNotes are now part of GitHub exports
```

### Step 2: Update Logger Integration

In `src/application.ts` or `src/main.ts`, set up the logger:

```typescript
import { setLogger as setGitHubLogger } from '@eldrforge/github-tools';
import { getLogger } from './logging';

// During initialization
const logger = getLogger();
setGitHubLogger(logger);
```

### Step 3: Update Prompt Integration

For interactive operations:

```typescript
import { setPromptFunction } from '@eldrforge/github-tools';
import { promptConfirmation } from './util/stdin';

// During initialization
setPromptFunction(promptConfirmation);
```

### Step 4: Remove Extracted Files

Once all imports are updated and tested:

```bash
cd /Users/tobrien/gitw/calenvarek/kodrdriv

# Remove source files (now in github-tools)
rm src/util/github.ts
rm src/content/issues.ts
rm src/content/releaseNotes.ts

# Remove corresponding tests
rm tests/util/github.test.ts
rm tests/content/issues.test.ts
rm tests/content/releaseNotes.test.ts
```

---

## Detailed File Updates

### 1. `src/commands/publish.ts`

**Find:**
```typescript
import * as GitHub from '../util/github';
import * as ReleaseNotes from '../content/releaseNotes';
```

**Replace with:**
```typescript
import * as GitHub from '@eldrforge/github-tools';
import { getReleaseNotesContent } from '@eldrforge/github-tools';
```

**Also update usage:**
```typescript
// If using ReleaseNotes.get()
const notes = await getReleaseNotesContent({ limit: 5 });
```

---

### 2. `src/commands/release.ts`

**Find:**
```typescript
import * as GitHub from '../util/github';
import * as ReleaseNotes from '../content/releaseNotes';
```

**Replace with:**
```typescript
import * as GitHub from '@eldrforge/github-tools';
import { getReleaseNotesContent } from '@eldrforge/github-tools';
```

---

### 3. `src/commands/review.ts`

**Find:**
```typescript
import * as GitHub from '../util/github';
import * as Issues from '../content/issues';
```

**Replace with:**
```typescript
import * as GitHub from '@eldrforge/github-tools';
import { getIssuesContent, handleIssueCreation } from '@eldrforge/github-tools';
```

**Update usage:**
```typescript
// If using Issues.get()
const issues = await getIssuesContent({ limit: 20 });

// If using Issues.handleIssueCreation()
await handleIssueCreation(/* ... */);
```

---

### 4. `src/commands/audio-review.ts`

**Find:**
```typescript
import * as Issues from '../content/issues';
```

**Replace with:**
```typescript
import { handleIssueCreation } from '@eldrforge/github-tools';
```

---

### 5. `src/commands/development.ts`

**Find:**
```typescript
import * as GitHub from '../util/github';
```

**Replace with:**
```typescript
import * as GitHub from '@eldrforge/github-tools';
```

---

### 6. Setup in `src/application.ts`

**Add near the top of the file (after imports):**

```typescript
import { setLogger as setGitLogger } from '@eldrforge/git-tools';
import { setLogger as setGitHubLogger, setPromptFunction } from '@eldrforge/github-tools';
import { promptConfirmation } from './util/stdin';

// ... existing code ...

export const initializeApplication = (config: Config) => {
    const logger = getLogger();

    // Configure git-tools logger
    setGitLogger(logger);

    // Configure github-tools logger and prompt
    setGitHubLogger(logger);
    setPromptFunction(promptConfirmation);

    // ... rest of initialization ...
};
```

---

## Testing After Integration

### 1. Build Test

```bash
cd /Users/tobrien/gitw/calenvarek/kodrdriv
npm run clean
npm run build
```

**Expected**: ✅ Build succeeds with no errors

### 2. Unit Tests

```bash
npm run test
```

**Expected**: ✅ All tests pass (tests using github-tools should work)

### 3. Integration Tests

Test key commands that use GitHub:

```bash
# Test with dry-run
./dist/main.js publish --dry-run
./dist/main.js release --dry-run
./dist/main.js review --dry-run
./dist/main.js development --dry-run
```

**Expected**: ✅ Commands execute without import errors

---

## Rollback Plan

If issues arise:

### Option 1: Keep Both Temporarily

Leave the old files in place while testing:

```bash
# Don't delete the old files yet
# Test with new imports
# If problems occur, revert imports
```

### Option 2: Git Revert

```bash
git checkout -- .
npm install
```

---

## Verification Checklist

After completing all updates:

- [ ] All imports updated to use `@eldrforge/github-tools`
- [ ] Logger configured via `setLogger()`
- [ ] Prompt function configured via `setPromptFunction()`
- [ ] Build succeeds without errors
- [ ] All tests pass
- [ ] Commands execute successfully
- [ ] Old files removed (`github.ts`, `issues.ts`, `releaseNotes.ts`)
- [ ] Old tests removed
- [ ] package.json shows `@eldrforge/github-tools` dependency

---

## Expected Benefits

After integration:

1. ✅ Reduced codebase size (~2000 LOC moved to external package)
2. ✅ Clearer separation of concerns
3. ✅ GitHub operations can be reused in other projects
4. ✅ Independent versioning of GitHub utilities
5. ✅ Easier to maintain and test

---

## Package Information

### Current Location
```
/Users/tobrien/gitw/calenvarek/github-tools
```

### Package Contents
- ✅ 25+ GitHub API functions
- ✅ Pull request management
- ✅ Issue management
- ✅ Milestone management
- ✅ Release operations
- ✅ Workflow monitoring
- ✅ Injectable logger and prompt function

### Dependencies
```json
{
  "@eldrforge/git-tools": "^0.1.1",
  "@octokit/rest": "^22.0.0"
}
```

---

## Next Steps

1. ⬅️ **Current**: Update import statements (see detailed updates above)
2. Configure logger and prompt in application.ts
3. Test build and execution
4. Remove old files once verified
5. Commit changes to kodrdriv
6. (Optional) Publish github-tools to npm
7. (Optional) Update kodrdriv to use published version

---

## Support

If you encounter issues:

1. Check that logger is configured before GitHub operations are called
2. Verify prompt function is set if using interactive operations
3. Ensure all imports use `@eldrforge/github-tools` (not relative paths)
4. Check that package is installed: `npm list @eldrforge/github-tools`

---

**Status**: ⬅️ Ready for import updates
**Next Action**: Update imports in command files
**Estimated Time**: 30 minutes

---

**Created**: November 13, 2025
**Package Version**: 0.1.0-dev.0
**Confidence**: HIGH ⭐⭐⭐⭐⭐

