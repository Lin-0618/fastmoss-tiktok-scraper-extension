(function initFastMossContentScript() {
  if (window.__fastMossTikTokScraperLoaded) {
    return;
  }

  window.__fastMossTikTokScraperLoaded = true;

  const runtimeApi = window.FastMossRuntime;
  const utils = window.FastMossUtils;
  const SUPPORTED_PATH = '/zh/media-source/video';
  const DEFAULT_POLL_MS = 350;
  const CHALLENGE_POLL_MS = 3000;

  let stopRequested = false;
  let manualResumeRequested = false;
  let currentRunPromise = null;
  let runConfig = buildRunConfig({});
  let state = runtimeApi.buildJobState({
    currentPage: '-',
    message: '等待开始。'
  });
  const detailCache = new Map();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === 'FM_SCRAPE_GET_STATE') {
      sendResponse({ ok: true, state: serializeState() });
      return false;
    }

    if (message.type === 'FM_SCRAPE_STOP') {
      stopRequested = true;
      manualResumeRequested = true;
      patchState({
        status: 'stopped',
        running: false,
        autoResumeActive: false,
        message: '正在停止，当前步骤结束后退出。'
      });
      sendResponse({ ok: true, state: serializeState() });
      return false;
    }

    if (message.type === 'FM_SCRAPE_RESUME') {
      manualResumeRequested = true;
      if (state.status === 'paused_challenge' || state.status === 'paused_manual') {
        patchState({
          message: '已收到继续指令，正在检查页面状态。',
          autoResumeActive: false
        });
      }
      sendResponse({ ok: true, state: serializeState() });
      return false;
    }

    if (message.type === 'FM_SCRAPE_RESUME_CHECK') {
      if (state.status === 'paused_challenge' && isScrapeSurfaceReady()) {
        manualResumeRequested = true;
      }
      sendResponse({ ok: true, state: serializeState() });
      return false;
    }

    if (message.type === 'FM_SCRAPE_START') {
      if (currentRunPromise) {
        sendResponse({ ok: true, state: serializeState() });
        return false;
      }

      if (!isSupportedPage()) {
        patchState({
          status: 'error',
          running: false,
          message: '当前页面不是 FastMoss 视频来源页。'
        });
        sendResponse({ ok: false, state: serializeState() });
        return false;
      }

      stopRequested = false;
      manualResumeRequested = false;
      runConfig = buildRunConfig(message);
      currentRunPromise = runScrape(runConfig).finally(() => {
        currentRunPromise = null;
      });

      sendResponse({ ok: true, state: serializeState() });
      return false;
    }

    return false;
  });

  async function runScrape(config) {
    const currentPage = detectCurrentPage() || 1;
    state = runtimeApi.buildJobState({
      status: 'running',
      running: true,
      currentPage,
      records: [],
      message: '正在准备抓取页面。',
      speedProfile: config.speedProfile,
      detailEnrichmentEnabled: config.detailEnrichmentEnabled,
      updatedAt: Date.now(),
      autoCloseOnComplete: config.autoCloseOnComplete
    });

    const speedProfile = runtimeApi.getSpeedProfile(config.speedProfile);
    let visitedPages = 0;

    try {
      await humanDelay(speedProfile.initialDelayMs, '正在等待页面稳定。');

      while (!stopRequested && visitedPages < config.maxPages) {
        if (!(await ensureReadyForScrape('准备抓取页面时遇到验证'))) {
          return;
        }

        if (!(await waitForRows(12000))) {
          return;
        }

        const page = detectCurrentPage() || visitedPages + 1;
        patchState({ currentPage: page });

        await maybeScrollTable();

        const pageRecords = await scrapeVisibleRows(page, speedProfile);
        const mergedRecords = utils.dedupeRecords(state.records.concat(pageRecords));
        patchState({
          records: mergedRecords,
          message: `第 ${page} 页完成，累计 ${mergedRecords.length} 条。`
        });
        visitedPages += 1;

        if (stopRequested) {
          break;
        }

        if (visitedPages % speedProfile.longPauseEveryPages === 0) {
          await humanDelay(speedProfile.longPauseMs, '正在进行较长停顿，降低抓取频率。');
        }

        const nextButton = findNextButton();
        if (!nextButton) {
          finish('complete', `没有下一页，抓取完成，共 ${state.records.length} 条。`);
          return;
        }

        const beforeSignature = getTableSignature();
        await humanDelay(speedProfile.nextPageDelayMs, `准备跳转到第 ${page + 1} 页。`);
        clickElement(nextButton);
        patchState({ message: `正在打开下一页，已抓取 ${state.records.length} 条。` });

        const changed = await waitForTableChange(beforeSignature, 15000, speedProfile.postPageLoadDelayMs);
        if (!changed) {
          finish('complete', `下一页没有继续变化，已停止，共 ${state.records.length} 条。`);
          return;
        }
      }

      if (stopRequested) {
        finish('stopped', `已停止，保留 ${state.records.length} 条记录。`);
        return;
      }

      finish('complete', `达到最多页数 ${config.maxPages}，已导出 ${state.records.length} 条。`);
    } catch (error) {
      finish('error', `抓取失败：${error.message}`);
    }
  }

  async function scrapeVisibleRows(page, speedProfile) {
    const records = getTableRows()
      .map((row, index) => {
        const cells = getRowCells(row)
          .map((cell) => normalizeCellText(cell.innerText || cell.textContent || ''))
          .filter(Boolean);
        const hrefs = Array.from(row.querySelectorAll('a[href]'))
          .map((anchor) => anchor.href || anchor.getAttribute('href'))
          .filter(Boolean);

        return utils.buildRecordFromCells({
          page,
          rowIndex: index + 1,
          sourceUrl: location.href,
          cellTexts: cells,
          hrefs
        });
      })
      .filter(hasUsefulRecord);

    return enrichMissingRecords(records, speedProfile);
  }

  async function enrichMissingRecords(records, speedProfile) {
    const output = [];

    for (let index = 0; index < records.length; index += 1) {
      if (stopRequested) {
        output.push(records[index]);
        continue;
      }

      if (!(await ensureReadyForScrape('补全详情页时遇到验证'))) {
        break;
      }

      const record = records[index];
      const needsHandle = !record.creatorHandle || !record.tiktokProfileUrl;
      const needsVideo = !record.tiktokVideoUrl && record.fastmossVideoId;

      if (!needsHandle && !needsVideo) {
        output.push(record);
        continue;
      }

      patchState({
        message: `正在补全第 ${state.currentPage} 页第 ${index + 1} 行达人链接。`
      });
      await humanDelay(speedProfile.rowGapMs);
      output.push(await enrichRecordFromDetails(record, speedProfile));
    }

    return output;
  }

  async function enrichRecordFromDetails(record, speedProfile) {
    if (!state.detailEnrichmentEnabled) {
      return record;
    }

    let enriched = record;

    if (record.fastmossInfluencerUrl) {
      const influencerHtml = await fetchDetailText(record.fastmossInfluencerUrl, speedProfile);
      if (influencerHtml) {
        enriched = utils.enrichRecordWithText(enriched, influencerHtml);
      }
    }

    if (!enriched.tiktokVideoUrl && record.fastmossVideoUrl) {
      const videoHtml = await fetchDetailText(record.fastmossVideoUrl, speedProfile);
      if (videoHtml) {
        enriched = utils.enrichRecordWithText(enriched, videoHtml);
      }
    }

    return enriched;
  }

  async function fetchDetailText(url, speedProfile) {
    if (!url || !/^https:\/\/www\.fastmoss\.com\//.test(url)) {
      return '';
    }

    if (detailCache.has(url)) {
      return detailCache.get(url);
    }

    try {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'force-cache'
      });

      if (!response.ok) {
        detailCache.set(url, '');
        return '';
      }

      const text = await response.text();
      detailCache.set(url, text);
      await humanDelay(speedProfile.rowGapMs);
      return text;
    } catch (_error) {
      detailCache.set(url, '');
      return '';
    }
  }

  async function ensureReadyForScrape(challengeReason) {
    if (isLoginWall()) {
      finish('error', 'FastMoss 登录已失效，请重新登录后再继续。');
      return false;
    }

    if (isChallengePage()) {
      return pauseForChallenge(challengeReason);
    }

    return true;
  }

  async function pauseForChallenge(reason) {
    patchState(runtimeApi.transitionJobState(state, {
      type: 'challenge_detected',
      reason: reason || 'challenge'
    }));
    patchState({
      message: '检测到验证页面，等待你完成验证后自动恢复。',
      currentPage: state.currentPage || detectCurrentPage() || '-'
    });

    let healthyChecks = 0;

    while (!stopRequested) {
      if (manualResumeRequested && isScrapeSurfaceReady()) {
        break;
      }

      if (isScrapeSurfaceReady()) {
        healthyChecks += 1;
        if (healthyChecks >= 2) {
          break;
        }
      } else {
        healthyChecks = 0;
      }

      await sleep(CHALLENGE_POLL_MS);
    }

    if (stopRequested) {
      finish('stopped', '任务已停止。');
      return false;
    }

    manualResumeRequested = false;
    await humanDelay(runtimeApi.getSpeedProfile(state.speedProfile).recoveryDelayMs, '验证已通过，等待页面稳定后继续。');
    patchState(runtimeApi.transitionJobState(state, { type: 'resume_requested' }));
    patchState({
      message: `验证已通过，从第 ${state.currentPage} 页继续抓取。`
    });
    return true;
  }

  function buildRunConfig(message) {
    return {
      maxPages: Math.max(1, Math.min(500, Number(message.maxPages) || 50)),
      speedProfile: message.speedProfile || 'slow',
      detailEnrichmentEnabled: message.detailEnrichmentEnabled !== false,
      autoCloseOnComplete: message.autoCloseOnComplete !== false
    };
  }

  function serializeState() {
    return Object.assign({}, state, {
      currentPage: state.currentPage || '-',
      autoCloseOnComplete: runConfig.autoCloseOnComplete
    });
  }

  function patchState(patch) {
    state = runtimeApi.buildJobState(Object.assign({}, state, patch, {
      updatedAt: Date.now()
    }));
  }

  function finish(status, message) {
    patchState({
      status,
      running: false,
      autoResumeActive: false,
      message
    });
  }

  function hasUsefulRecord(record) {
    return Boolean(
      record.videoTitle ||
      record.creatorName ||
      record.tiktokProfileUrl ||
      record.followers ||
      record.publishedAt ||
      record.views
    );
  }

  function isSupportedPage() {
    return location.hostname === 'www.fastmoss.com' && location.pathname.startsWith(SUPPORTED_PATH);
  }

  function isLoginWall() {
    return /login|signin/i.test(location.pathname) || /登录|sign in/i.test(readBodyText(1200));
  }

  function isChallengePage() {
    const text = readBodyText(5000);
    if (runtimeApi.isChallengeText(text)) {
      return true;
    }

    return Boolean(
      document.querySelector('iframe[src*="challenge"], iframe[title*="challenge"], iframe[src*="captcha"]') ||
      document.querySelector('[name="cf-turnstile-response"], [data-sitekey], #cf-challenge-running')
    );
  }

  function isScrapeSurfaceReady() {
    return isSupportedPage() && !isChallengePage() && getTableRows().length > 0;
  }

  function readBodyText(limit) {
    return utils.normalizeWhitespace((document.body && document.body.innerText) || '').slice(0, limit || 4000);
  }

  function getTableRows() {
    const tableRows = Array.from(document.querySelectorAll('tbody tr'))
      .filter(isVisible)
      .filter((row) => getRowCells(row).length >= 4);

    if (tableRows.length > 0) {
      return tableRows;
    }

    return Array.from(document.querySelectorAll('[role="row"]'))
      .filter(isVisible)
      .filter((row) => getRowCells(row).length >= 4);
  }

  function getRowCells(row) {
    const cells = Array.from(row.querySelectorAll('td, [role="cell"], .ant-table-cell'));
    const visibleCells = cells.filter(isVisible);
    return visibleCells.length > 0 ? visibleCells : cells;
  }

  function normalizeCellText(text) {
    return utils.normalizeWhitespace(String(text || '').replace(/\r/g, '\n'));
  }

  function findNextButton() {
    const directSelectors = [
      '.ant-pagination-next:not(.ant-pagination-disabled)',
      '[aria-label="Next Page"]:not([aria-disabled="true"])',
      '[aria-label="next page"]:not([aria-disabled="true"])',
      '[title="下一页"]:not([aria-disabled="true"])',
      '[title="Next Page"]:not([aria-disabled="true"])'
    ];

    for (const selector of directSelectors) {
      const element = document.querySelector(selector);
      if (element && isVisible(element) && !isDisabled(element)) {
        return element.querySelector('button, a') || element;
      }
    }

    const candidates = Array.from(document.querySelectorAll('button, a, li, [role="button"]'))
      .filter(isVisible)
      .filter((element) => !isDisabled(element));

    return candidates.find((element) => {
      const signature = [
        element.innerText,
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.className
      ].join(' ');

      return /下一页|下页|next|pagination-next|right|›|»|>/i.test(signature) &&
        !/上一页|上页|prev|previous|pagination-prev|left|‹|«/i.test(signature);
    }) || null;
  }

  function isDisabled(element) {
    if (!element) {
      return true;
    }

    const disabledAncestor = element.closest('[disabled], [aria-disabled="true"], .disabled, .is-disabled, .ant-pagination-disabled');
    return Boolean(element.disabled || disabledAncestor);
  }

  async function maybeScrollTable() {
    const table = document.querySelector('tbody') || document.querySelector('.ant-table-body') || document.scrollingElement;
    if (!table || typeof table.scrollIntoView !== 'function') {
      return;
    }

    table.scrollIntoView({ block: 'center', inline: 'nearest' });
    await sleep(120);
  }

  function clickElement(element) {
    const target = element.querySelector('button:not([disabled]), a[href], [role="button"]') || element;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.click();
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  }

  function getTableSignature() {
    const rows = getTableRows().slice(0, 8);
    const activePage = detectCurrentPage();
    const rowText = rows
      .map((row) => utils.normalizeWhitespace(row.innerText || row.textContent || '').slice(0, 240))
      .join('|');

    return `${activePage || ''}::${rowText}`;
  }

  function detectCurrentPage() {
    const activeSelectors = [
      '.ant-pagination-item-active',
      '[aria-current="page"]',
      '.pagination .active',
      '.el-pager .active'
    ];

    for (const selector of activeSelectors) {
      const active = document.querySelector(selector);
      if (!active || !isVisible(active)) {
        continue;
      }

      const number = parseInt((active.innerText || active.textContent || '').match(/\d+/)?.[0] || '', 10);
      if (Number.isFinite(number)) {
        return number;
      }
    }

    const pageFromUrl = new URLSearchParams(location.search).get('page');
    const parsedPage = parseInt(pageFromUrl || '', 10);
    return Number.isFinite(parsedPage) ? parsedPage : '';
  }

  async function waitForRows(timeoutMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (stopRequested) {
        return false;
      }

      if (isChallengePage()) {
        const resumed = await pauseForChallenge('等待列表时触发验证');
        if (!resumed) {
          return false;
        }
      }

      if (getTableRows().length > 0) {
        return true;
      }

      await sleep(DEFAULT_POLL_MS);
    }

    throw new Error('没有找到可抓取的表格行');
  }

  async function waitForTableChange(previousSignature, timeoutMs, initialDelayRange) {
    const startedAt = Date.now();
    await humanDelay(initialDelayRange);

    while (Date.now() - startedAt < timeoutMs) {
      if (stopRequested) {
        return false;
      }

      if (isChallengePage()) {
        const resumed = await pauseForChallenge('翻页时触发验证');
        if (!resumed) {
          return false;
        }
      }

      const currentSignature = getTableSignature();
      if (currentSignature && currentSignature !== previousSignature && getTableRows().length > 0) {
        return true;
      }

      await sleep(DEFAULT_POLL_MS);
    }

    return false;
  }

  async function humanDelay(range, message) {
    if (message) {
      patchState({ message });
    }

    if (!range) {
      return;
    }

    const min = Number(range.min) || 0;
    const max = Number(range.max) || min;
    const value = min >= max ? min : Math.floor(Math.random() * (max - min + 1)) + min;
    await sleep(value);
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0;
  }
})();
