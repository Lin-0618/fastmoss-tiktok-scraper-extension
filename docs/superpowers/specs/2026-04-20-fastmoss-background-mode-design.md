# FastMoss Background Scrape Mode Design

## Goal

Upgrade the Chrome extension so scraping no longer depends on the user keeping the FastMoss page open in the foreground. The extension should open and manage its own background tab, scrape with a slower and more human-like rhythm, keep using the browser's existing logged-in FastMoss session, and survive captcha/challenge interruptions without discarding progress.

## Recommendation

Use a managed background tab instead of pure API/background requests. This keeps the current session model, preserves the DOM-based extraction logic that already works, and avoids the higher risk of Cloudflare, signing, or hidden API changes that would come with a request-only design.

## Scope

This version adds:

- a background-tab scraping mode
- slower randomized pacing to reduce bot-like behavior
- shared task state so the popup can monitor a job that runs in another tab
- optional detail-page enrichment throttling
- challenge detection with pause-and-resume behavior

This version does not:

- replace FastMoss with a full API client
- automate login
- run after the browser is closed
- guarantee bypass of anti-bot systems

## User Flow

The user logs in to FastMoss once in Chrome. In the popup, the user starts a scrape job and selects a slower speed profile. The extension opens a dedicated FastMoss tab in the background, navigates it to the target page, and runs the scraper there. The popup shows progress, allows stop/cancel, and still exports CSV/TXT results. The user can continue browsing other tabs while the job runs.

If a captcha or challenge page appears, the job pauses instead of discarding progress. The extension keeps the collected records and current page, waits for the page to recover, and resumes automatically when the table returns. The popup also offers a manual resume action for cases where the automatic recovery check does not trigger.

## Architecture

Add a service-worker background controller that owns job lifecycle, tab creation, shared state, and pause/resume behavior. The popup talks to the background controller instead of sending all commands directly to the active tab. The content script remains responsible for page extraction and page-to-page navigation, but it now receives a richer runtime config from the background controller.

Key responsibilities:

- `background.js`
  Creates or reuses the managed FastMoss tab, stores job state, forwards commands, watches tab updates, polls for recovery after challenges, and tears down jobs cleanly.
- `content.js`
  Scrapes rows, handles pagination, detects challenge/login walls, and applies randomized waits, scrolls, and enrichment throttling.
- `popup.js`
  Starts/stops/resumes jobs through the background controller, renders progress, and exposes user controls for speed and background mode.
- `src/fastmoss-utils.js`
  Keeps pure parsing/export logic and gains small testable helpers for timing profiles and challenge detection text matching where useful.

## Background Tab Model

When a job starts, the extension creates a dedicated tab with `active: false` and the target FastMoss URL. The background controller waits for the page to finish loading, ensures the content scripts are present, then sends a start message with job settings.

The background tab remains open for the duration of the job unless the user stops it. After completion, the tab can either remain open for inspection or be auto-closed depending on a simple config flag. The first implementation should default to auto-close after successful completion, but keep the tab open on errors or while paused for a challenge.

## Human-Like Pacing

To reduce obvious automation patterns, replace fixed waits with bounded randomized timing:

- initial page settle wait
- row/detail enrichment gap
- next-page pre-click wait
- post-click load wait
- occasional longer pause every few pages
- recovery cool-down wait after a challenge

Behavior should also include mild interaction noise when possible:

- scroll the table area before or after extraction
- occasionally move focus to the next-page button before click
- vary detail-page fetch spacing

These actions should be deterministic enough to debug but randomized enough to avoid a strict robotic cadence. Use a named speed profile instead of raw numbers in the popup:

- `slow`
- `very_slow`

## Shared State

Move job state ownership from the content script alone into the background controller. The popup should be able to read:

- job status
- active page
- total record count
- managed tab id
- selected speed profile
- whether detail enrichment is enabled
- last error message
- pause reason
- whether auto-resume polling is active

Use an explicit state machine:

- `idle`
- `running`
- `paused_challenge`
- `paused_manual`
- `stopped`
- `complete`
- `error`

The content script should still report incremental progress upward, but it should not be the single source of truth for whether a job exists.

## Error Handling

Handle these cases explicitly:

- user is not logged in and the managed tab lands on a login wall
- FastMoss tab is closed during a run
- pagination stalls
- detail enrichment hits repeated failures
- Cloudflare or challenge pages appear

On repeated enrichment failures, the scraper should degrade gracefully by keeping partial row data and continuing pagination. Challenge pages should pause the job instead of forcing a restart. Login walls should stop the job and surface a clear message asking the user to refresh the FastMoss session manually.

## Challenge Handling

Detect challenge-like states using a combination of:

- page text such as `verify you are human`, `challenge`, `captcha`, `验证`, `请完成验证`
- known Cloudflare markers
- absence of the expected table plus presence of challenge form elements

When a challenge is detected:

- pause the job instead of discarding results
- preserve records, page number, selected speed profile, and tab id
- set state to `paused_challenge`
- begin light auto-resume polling against the managed tab

When the page appears healthy again:

- wait an additional cool-down interval
- re-check that the table exists
- resume scraping from the same page instead of restarting the whole job

The popup should also expose a `Resume` button that asks the background controller to retry immediately. Manual resume should be allowed only when the page has returned to a usable state.

## Testing

Keep Node tests focused on pure helpers and configuration logic. Syntax checks should cover the new background script. Manual verification should include:

- start a job from the popup without the FastMoss list tab already active
- observe a background tab open and scrape
- confirm the user can browse other tabs while the job runs
- trigger a pause state and verify automatic recovery works
- verify manual resume works when automatic recovery does not
- verify stop/cancel works
- verify exports still contain complete records

## Rollout Strategy

Implement the background controller first while keeping the old content-script scraping loop mostly intact. Then layer in pacing profiles, challenge pause/resume, and detail enrichment throttling. This keeps the change set understandable and makes it easier to isolate regressions between architecture and timing behavior.
