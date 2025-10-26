# Git Branching Protocol
**D2D Sales Tracker - Hail Intelligence System**

## CRITICAL SAFETY RULES

### **RULE #1: NEVER COMMIT DIRECTLY TO MAIN**
- Main branch is production-ready code only
- ALL changes must go through a feature/fix branch first
- Breaking this rule can brick the iOS app deployment

### **RULE #2: ALWAYS CREATE A NEW BRANCH BEFORE ANY CHANGES**
- Even for "quick fixes" - no exceptions
- Test changes on branch before merging
- If things go sideways, easy rollback without affecting main

### **RULE #3: CONSULT THE ARCHITECTURE DOCUMENTS FIRST**
Before making ANY architectural changes, read:
- `CORE_ARCHITECTURE_SNAPSHOT.md` - "The Bible" - defines what MUST NOT change
- `3TIER_IMPLEMENTATION.md` - Data tier specifications
- `DATA_FLOW_VERIFICATION.md` - How data flows through the system
- `SESSION_HANDOFF_2025_10_25.md` - Latest session context and decisions

---

## Branch Naming Conventions

### **Feature Branches**
Format: `feature/<description>`

**Examples:**
- `feature/serverless-backend-migration`
- `feature/push-notifications`
- `feature/canvassing-route-optimizer`

**When to use:**
- Adding new functionality
- Implementing new user-facing features
- Major refactoring or migrations

### **Fix Branches**
Format: `fix/<description>`

**Examples:**
- `fix/timezone-date-parsing`
- `fix/metro-bundler-tsconfig`
- `fix/stale-data-cache`

**When to use:**
- Fixing bugs
- Correcting data formatting issues
- Patching broken functionality

### **Release Branches**
Format: `release/v<version>`

**Examples:**
- `release/v1.0.0`
- `release/v1.1.0`

**When to use:**
- Preparing for production release
- Final testing before deployment
- Version bumps and changelog updates

### **Hotfix Branches**
Format: `hotfix/<description>`

**Examples:**
- `hotfix/critical-crash-ios`
- `hotfix/data-loss-prevention`

**When to use:**
- Emergency fixes to production
- Critical bugs affecting users
- Security vulnerabilities

---

## Workflow Steps

### **Starting New Work**

```bash
# 1. Ensure you're on latest main
git checkout main
git pull origin main

# 2. Create new branch with descriptive name
git checkout -b feature/your-feature-name

# 3. Verify you're on the new branch
git branch --show-current
```

### **Making Changes**

```bash
# 1. Make your code changes
# 2. Test thoroughly (run app, test affected features)

# 3. Stage changes
git add path/to/changed/files

# 4. Commit with descriptive message (see format below)
git commit -m "feat: add serverless backend processing

- Implement Vercel Edge Function for GRIB2 processing
- Add SPC pre-filtering to reduce processing by 96%
- Configure Cloudflare R2 for permanent cache storage
- Update app config to use serverless endpoint

Closes #123"

# 5. Push to remote
git push -u origin feature/your-feature-name
```

### **Testing Before Merge**

**Checklist:**
- [ ] App builds without errors (`npx expo start`)
- [ ] TypeScript compiles without errors
- [ ] All affected features tested on iOS device
- [ ] No console errors or warnings
- [ ] Data loads correctly (not falling back to mock data)
- [ ] No timezone bugs or date formatting issues
- [ ] Backend endpoints respond correctly
- [ ] No performance degradation

### **Merging to Main**

```bash
# 1. Ensure all tests pass on branch
# 2. Merge main into your branch first (to catch conflicts)
git checkout feature/your-feature-name
git pull origin main

# 3. Resolve any conflicts
# 4. Test again after merge

# 5. Switch to main and merge your branch
git checkout main
git merge feature/your-feature-name

# 6. Push to remote
git push origin main

# 7. Delete merged branch (cleanup)
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

---

## Commit Message Format

### **Standard Format**
```
<type>: <subject>

<body>

<footer>
```

### **Types**
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring (no functionality change)
- `perf:` Performance improvements
- `test:` Adding or updating tests
- `chore:` Maintenance tasks (dependencies, config)
- `style:` Code style changes (formatting, semicolons)

### **Examples**

**Good Commit:**
```
fix: timezone bug in date parsing for historical data

Changed getDate() to getUTCDate() in iemArchiveService.ts and
mrmsParser.ts to fix -1 day offset when querying MRMS archive.

Before: Searching "May 17" queried "May 16" (CDT -5 hours)
After: Searching "May 17" correctly queries "May 17" (UTC)

Tested with May 25, 2025 storm (748 reports) - now loads correctly.

Files changed:
- src/services/iemArchiveService.ts:31-36
- src/services/mrmsParser.ts:342-346
```

**Bad Commit:**
```
fixed stuff
```

---

## Emergency Rollback Procedures

### **Scenario 1: Bad Commit on Branch**
```bash
# Undo last commit, keep changes
git reset --soft HEAD~1

# Undo last commit, discard changes
git reset --hard HEAD~1
```

### **Scenario 2: Bad Merge to Main**
```bash
# Find the commit hash before the bad merge
git log --oneline

# Reset main to that commit
git reset --hard <commit-hash>

# Force push (DANGEROUS - only if you're sure!)
git push origin main --force
```

### **Scenario 3: Need to Quickly Revert**
```bash
# Create a new commit that undoes previous commit
git revert HEAD

# Revert specific commit
git revert <commit-hash>
```

### **Scenario 4: Nuclear Option (Start Fresh)**
```bash
# Stash all changes
git stash

# Return to last known good state
git checkout main
git pull origin main

# Create new branch and manually re-apply changes
git checkout -b fix/recover-from-mistake
git stash pop
```

---

## Protected Files and Directories

### **NEVER Directly Edit (Without Branch)**
- `CORE_ARCHITECTURE_SNAPSHOT.md` - System architecture definition
- `package.json` - Dependencies (can break app)
- `app.json` - Expo config (can break build)
- `tsconfig.json` - TypeScript config (can break compilation)

### **Edit with Extreme Caution**
- `src/services/iemArchiveService.ts` - Tier 2 data fetching (user's top priority)
- `src/services/mrmsService.ts` - Tier 1 real-time alerts
- `src/services/spcService.ts` - Tier 3 validation
- `src/services/mrmsParser.ts` - Data parsing logic

### **Excluded from Version Control**
- `.env` - Environment variables (never commit!)
- `node_modules/` - Dependencies
- `mrms-proxy-server/preprocessed/` - Generated data files
- `.expo/` - Expo build artifacts

---

## Architecture Change Protocol

### **Before Making Architectural Changes:**

1. **Read the Bible** - `CORE_ARCHITECTURE_SNAPSHOT.md`
   - Check if your change violates core architecture
   - Verify it aligns with 3-tier system design

2. **Check Recent Sessions** - `SESSION_HANDOFF_2025_10_25.md`
   - Understand recent decisions and context
   - Avoid re-introducing fixed bugs

3. **Create Architecture Decision Record (ADR)**
   - Document WHY you're making the change
   - Explain alternatives considered
   - List potential risks and mitigation

4. **Create Feature Branch**
   ```bash
   git checkout -b feature/architectural-change-description
   ```

5. **Implement with Kill Switch**
   - Add feature flags to easily disable if needed
   - Implement graceful fallbacks
   - Log extensively for debugging

6. **Test Exhaustively**
   - Test all 3 tiers of data flow
   - Verify iOS app functionality
   - Check backend server responses
   - Monitor for memory leaks or performance issues

7. **Update Documentation**
   - Update relevant .md files
   - Add inline code comments
   - Create handoff notes for next session

---

## Common Scenarios

### **Fixing a Bug**
```bash
git checkout main
git pull origin main
git checkout -b fix/descriptive-bug-name
# Make changes, test
git add .
git commit -m "fix: descriptive message"
git push -u origin fix/descriptive-bug-name
# Test on iOS device
# Merge to main when confirmed working
```

### **Adding a New Feature**
```bash
git checkout main
git pull origin main
git checkout -b feature/feature-name
# Implement feature, test
git add .
git commit -m "feat: descriptive message"
git push -u origin feature/feature-name
# Get user feedback
# Iterate on branch
# Merge when feature complete and tested
```

### **Serverless Migration (Current Priority)**
```bash
git checkout main
git pull origin main
git checkout -b feature/serverless-backend-migration

# Implement in stages:
# Stage 1: Set up Vercel + Cloudflare R2
git add .
git commit -m "feat(serverless): initial Vercel and R2 setup"

# Stage 2: Implement SPC pre-filtering
git add .
git commit -m "feat(serverless): add SPC storm report pre-filtering"

# Stage 3: Port GRIB2 processing
git add .
git commit -m "feat(serverless): port GRIB2 processing to Edge Function"

# Stage 4: Update app config
git add .
git commit -m "feat(serverless): update app to use serverless endpoint"

# Test each stage before proceeding
# Merge to main only when fully functional and tested
```

---

## Branch Status Reference

### **Current Active Branches** (as of October 25, 2025)
- `main` - Production code
- `develop` - Integration branch (if using Gitflow)
- `feature/phase-3-proper-implementation` - Legacy feature branch
- `fix/timezone-date-parsing` - Current bug fix (in progress)

### **Branch Lifecycle**
1. **Create** - Branch off main with descriptive name
2. **Develop** - Make commits, push to remote
3. **Test** - Verify functionality on branch
4. **Merge** - Pull main, resolve conflicts, merge back
5. **Delete** - Remove branch after successful merge
6. **Monitor** - Watch for issues after merge, revert if needed

---

## Git Aliases (Optional Productivity Boost)

Add to `~/.gitconfig`:
```
[alias]
    # Quick status
    s = status -s

    # Create and checkout feature branch
    feature = "!f() { git checkout -b feature/$1; }; f"
    fix = "!f() { git checkout -b fix/$1; }; f"

    # Pretty log
    lg = log --oneline --graph --decorate --all

    # Undo last commit (keep changes)
    undo = reset --soft HEAD~1

    # Amend last commit (useful for typos)
    amend = commit --amend --no-edit
```

**Usage:**
```bash
git feature serverless-migration
git fix timezone-parsing
git lg
git undo
```

---

## Final Reminders

1. **When in doubt, create a branch**
2. **Test before merging to main**
3. **Write descriptive commit messages** - your future self will thank you
4. **Keep branches short-lived** - merge or delete within days, not weeks
5. **One branch per feature/fix** - don't mix unrelated changes
6. **Always pull main before creating new branch** - avoid conflicts
7. **Read the architecture docs** - understand what you're changing
8. **Document your decisions** - update .md files and code comments

---

## Questions or Concerns?

If you're a future Claude instance reading this:
- Check `SESSION_HANDOFF_2025_10_25.md` for latest context
- Review `CORE_ARCHITECTURE_SNAPSHOT.md` for architecture rules
- Create a new branch BEFORE making ANY changes
- When in doubt, ask the user before proceeding

**User Quote:**
> "also make sure before we do any changes to our app that we start any new app development changes on a new branch of github in case things go sideways as per protocol... emphasis on this last part!!"

This protocol exists to protect the app from breaking changes. Follow it religiously.
