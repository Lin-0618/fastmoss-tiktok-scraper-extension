# FastMoss TikTok Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that extracts FastMoss video table rows, automatically paginates, and exports complete TikTok creator data.

**Architecture:** Keep browser-specific DOM automation in `content.js`, popup interactions in `popup.js`, and reusable parsing/export helpers in `src/fastmoss-utils.js`. The pure helper module supports Node tests and a browser global.

**Tech Stack:** Chrome Manifest V3, vanilla JavaScript, HTML/CSS, Node built-in test runner.

---

### Task 1: Parser And Export Helpers

**Files:**
- Create: `src/fastmoss-utils.js`
- Create: `tests/fastmoss-utils.test.js`

- [x] **Step 1: Write failing tests**

Write tests for handle extraction, row-field mapping, CSV escaping, TXT link export, and dedupe by TikTok URL.

- [x] **Step 2: Run tests to verify failure**

Run: `node --test tests/fastmoss-utils.test.js`

Expected: FAIL because `src/fastmoss-utils.js` does not exist yet.

- [x] **Step 3: Implement helpers**

Create functions: `normalizeWhitespace`, `extractHandle`, `buildTikTokProfileUrl`, `buildRecordFromCells`, `recordsToCsv`, `recordsToLinkText`, and `dedupeRecords`.

- [x] **Step 4: Run tests to verify pass**

Run: `node --test tests/fastmoss-utils.test.js`

Expected: PASS.

### Task 2: Extension Shell

**Files:**
- Create: `manifest.json`
- Create: `popup.html`
- Create: `popup.css`
- Create: `popup.js`

- [x] **Step 1: Add Manifest V3 config**

Register popup files and content scripts for `https://www.fastmoss.com/*`.

- [x] **Step 2: Add popup controls**

Create Start, Stop, Copy CSV, Download CSV, and Download TXT controls with status and record count.

- [x] **Step 3: Wire popup messaging**

Send `FM_SCRAPE_START`, `FM_SCRAPE_STOP`, and `FM_SCRAPE_GET_STATE` messages to the active tab and render responses.

### Task 3: Content Scraper And Pagination

**Files:**
- Create: `content.js`

- [x] **Step 1: Extract visible rows**

Read table rows from `tbody tr` or table-like role rows and pass cell text/link data to `buildRecordFromCells`.

- [x] **Step 2: Add automatic next-page loop**

After each page, click the next-page control if it is present and enabled, then wait for the table signature to change.

- [x] **Step 3: Maintain state**

Track `status`, `running`, `currentPage`, `records`, and `message` so the popup can refresh progress.

### Task 4: Verification

**Files:**
- Modify: `package.json`

- [x] **Step 1: Add test script**

Add `node --test tests/*.test.js`.

- [x] **Step 2: Run unit tests**

Run: `npm test`

Expected: PASS.

- [x] **Step 3: Run syntax checks**

Run: `node --check src/fastmoss-utils.js`, `node --check content.js`, and `node --check popup.js`.

Expected: all commands exit successfully.
