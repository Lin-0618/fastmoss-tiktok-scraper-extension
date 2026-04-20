# FastMoss Background Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a background-tab scraping mode with slower human-like pacing plus captcha pause/resume behavior that preserves progress.

**Architecture:** Introduce a Manifest V3 background service worker to own job lifecycle and shared state while keeping DOM scraping inside the content script. Add testable helper modules for timing profiles and challenge detection so popup, background, and content logic can share the same rules.

**Tech Stack:** Chrome Manifest V3, vanilla JavaScript, Node built-in test runner.

---

### Task 1: Extract Runtime Helpers

**Files:**
- Create: `src/fastmoss-runtime.js`
- Create: `tests/fastmoss-runtime.test.js`

- [ ] **Step 1: Write the failing tests**

Add tests for:
- speed profile lookup returning bounded delays
- challenge detection from page text markers
- resume state transitions preserving record count and page number

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/fastmoss-runtime.test.js`
Expected: FAIL because `src/fastmoss-runtime.js` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:
- `getSpeedProfile(profileName)`
- `isChallengeText(text)`
- `buildJobState(partial)`
- `transitionJobState(state, event)`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/fastmoss-runtime.test.js`
Expected: PASS.

### Task 2: Add Background Controller

**Files:**
- Modify: `manifest.json`
- Create: `background.js`

- [ ] **Step 1: Add background script registration**

Register a service worker and required permissions for tab lifecycle management.

- [ ] **Step 2: Implement managed-tab job controller**

Support:
- start job
- stop job
- resume job
- read shared state
- create inactive FastMoss tab
- forward config to content script

- [ ] **Step 3: Add challenge polling behavior**

When state becomes `paused_challenge`, poll the managed tab and auto-resume after a recovery delay when the page becomes healthy again.

### Task 3: Refit Popup Controls

**Files:**
- Modify: `popup.html`
- Modify: `popup.css`
- Modify: `popup.js`

- [ ] **Step 1: Add controls for background mode and speed**

Expose:
- background-tab mode toggle
- speed profile select
- manual resume button

- [ ] **Step 2: Switch popup messaging to background controller**

Replace direct active-tab ownership with background-owned job commands and shared state reads.

- [ ] **Step 3: Render pause/resume states**

Show pause reason, auto-resume messaging, and enable/disable controls correctly.

### Task 4: Upgrade Content Script

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Accept runtime config from background**

Use speed profile values and background mode job metadata instead of hard-coded timing.

- [ ] **Step 2: Add challenge detection and pause reporting**

Detect challenge pages before scraping, between pages, and before enrichment fetches. Report pause state instead of failing the job.

- [ ] **Step 3: Add human-like pacing**

Replace fixed waits with randomized waits, scroll touches, and periodic longer rests.

- [ ] **Step 4: Resume from preserved page state**

When the background controller resumes the content script, continue from the current page without clearing existing records.

### Task 5: Verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add runtime test coverage to the test command**

Make sure `npm test` includes `tests/fastmoss-runtime.test.js`.

- [ ] **Step 2: Run unit tests**

Run: `npm.cmd test`
Expected: PASS.

- [ ] **Step 3: Run syntax checks**

Run: `npm.cmd run check`
Expected: PASS including `background.js`.
