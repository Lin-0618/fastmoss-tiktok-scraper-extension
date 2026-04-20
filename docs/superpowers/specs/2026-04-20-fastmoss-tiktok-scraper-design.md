# FastMoss TikTok Scraper Extension Design

## Goal

Build a Chrome extension that runs on `https://www.fastmoss.com/zh/media-source/video`, extracts the visible video table data, automatically advances through result pages, and exports both complete records and TikTok creator profile links.

## Recommendation

Use a Chrome extension instead of a standalone desktop app. FastMoss pages usually depend on the browser login session, so an extension can read the page the user already opened without separately handling account login, cookies, captcha, or browser fingerprint issues.

## Scope

The first version captures the current FastMoss video source table and all subsequent pages reachable through the page's next-page control. It does not log in, bypass paywalls, run in the background on a schedule, or apply filtering.

## Captured Fields

Each row exports:

- `page`
- `rowIndex`
- `videoTitle`
- `duration`
- `creatorName`
- `creatorHandle`
- `tiktokProfileUrl`
- `country`
- `category`
- `followers`
- `publishedAt`
- `views`
- `sourceUrl`

## User Flow

The user opens FastMoss in Chrome, logs in normally, navigates to `https://www.fastmoss.com/zh/media-source/video`, then opens the extension popup and clicks Start. The extension collects the current page, clicks the next-page control, waits for the table to change, and repeats until the next-page control is missing or disabled. The popup shows progress, supports stopping, and offers CSV/TXT export.

## Architecture

`manifest.json` registers a Manifest V3 extension for FastMoss pages. `popup.html`, `popup.css`, and `popup.js` provide the controls and export actions. `src/fastmoss-utils.js` contains pure parsing, dedupe, and export helpers that can run in both Chrome and Node tests. `content.js` handles DOM scraping, pagination, progress state, and communication with the popup.

## Pagination

The content script finds likely next-page buttons by checking disabled state, `aria-label`, class names, and text such as `下一页`, `Next`, `>`, and `›`. After clicking, it waits until the visible table signature changes or the page indicator changes. A hard page limit prevents accidental infinite loops.

## Error Handling

If the current tab is not a supported FastMoss page, the popup reports that the page is unsupported. If no rows are found, the extension returns an empty result with a clear status. If pagination stalls, the scraper stops and keeps the records already collected. Missing row fields are exported as empty strings rather than failing the whole run.

## Verification

Pure parsing and export behavior is covered by Node tests. The extension files are checked for JavaScript syntax with Node. Manual verification is done by loading the unpacked extension in Chrome and running it on the FastMoss page.
