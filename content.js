(function initFastMossContentScript() {
  if (window.__fastMossTikTokScraperLoaded) {
    return;
  }

  window.__fastMossTikTokScraperLoaded = true;

  const utils = window.FastMossUtils;
  const SUPPORTED_PATH = '/zh/media-source/video';
  const POLL_MS = 350;

  let stopRequested = false;
  let state = createInitialState();
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
      if (state.running) {
        state.message = '正在停止，当前页处理完后结束。';
      }
      sendResponse({ ok: true, state: serializeState() });
      return false;
    }

    if (message.type === 'FM_SCRAPE_START') {
      if (state.running) {
        sendResponse({ ok: true, state: serializeState() });
        return false;
      }

      if (!isSupportedPage()) {
        state = Object.assign(createInitialState(), {
          status: 'error',
          message: '当前页面不是 FastMoss 视频来源页。'
        });
        sendResponse({ ok: false, state: serializeState() });
        return false;
      }

      const maxPages = Math.max(1, Math.min(500, Number(message.maxPages) || 50));
      runScrape({ maxPages });
      sendResponse({ ok: true, state: serializeState() });
      return false;
    }

    return false;
  });

  function createInitialState() {
    return {
      status: 'idle',
      running: false,
      currentPage: '',
      records: [],
      message: '等待开始。',
      updatedAt: Date.now()
    };
  }

  function serializeState() {
    return {
      status: state.status,
      running: state.running,
      currentPage: state.currentPage,
      records: state.records,
      message: state.message,
      updatedAt: state.updatedAt
    };
  }

  async function runScrape(options) {
    stopRequested = false;
    state = {
      status: 'running',
      running: true,
      currentPage: detectCurrentPage() || 1,
      records: [],
      message: '开始抓取当前页。',
      updatedAt: Date.now()
    };

    let visitedPages = 0;

    try {
      while (!stopRequested && visitedPages < options.maxPages) {
        await waitForRows(12000);

        const page = detectCurrentPage() || visitedPages + 1;
        state.currentPage = page;

        const pageRecords = await scrapeVisibleRows(page);
        state.records = utils.dedupeRecords(state.records.concat(pageRecords));
        visitedPages += 1;
        setMessage(`第 ${page} 页完成，累计 ${state.records.length} 条。`);

        if (stopRequested) {
          break;
        }

        const nextButton = findNextButton();
        if (!nextButton) {
          finish('complete', `没有下一页，抓取完成，共 ${state.records.length} 条。`);
          return;
        }

        const beforeSignature = getTableSignature();
        clickElement(nextButton);
        setMessage(`正在打开下一页，已抓取 ${state.records.length} 条。`);

        const changed = await waitForTableChange(beforeSignature, 15000);
        if (!changed) {
          finish('complete', `下一页没有继续变化，已停止，共 ${state.records.length} 条。`);
          return;
        }
      }

      if (stopRequested) {
        finish('stopped', `已停止，保留 ${state.records.length} 条记录。`);
        return;
      }

      finish('complete', `达到最多页数 ${options.maxPages}，已导出 ${state.records.length} 条。`);
    } catch (error) {
      finish('error', `抓取失败：${error.message}`);
    }
  }

  function finish(status, message) {
    state.status = status;
    state.running = false;
    state.message = message;
    state.updatedAt = Date.now();
  }

  function setMessage(message) {
    state.message = message;
    state.updatedAt = Date.now();
  }

  function isSupportedPage() {
    return location.hostname === 'www.fastmoss.com' && location.pathname.startsWith(SUPPORTED_PATH);
  }

  async function scrapeVisibleRows(page) {
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

    return enrichMissingRecords(records);
  }

  async function enrichMissingRecords(records) {
    const output = [];

    for (let index = 0; index < records.length; index += 1) {
      if (stopRequested) {
        output.push(records[index]);
        continue;
      }

      const record = records[index];
      const needsHandle = !record.creatorHandle || !record.tiktokProfileUrl;
      const needsVideo = !record.tiktokVideoUrl && record.fastmossVideoId;

      if (!needsHandle && !needsVideo) {
        output.push(record);
        continue;
      }

      setMessage(`正在补全第 ${record.currentPage || state.currentPage || ''} 页第 ${index + 1} 行达人链接。`);
      output.push(await enrichRecordFromDetails(record));
    }

    return output;
  }

  async function enrichRecordFromDetails(record) {
    let enriched = record;

    if (record.fastmossInfluencerUrl) {
      const influencerHtml = await fetchDetailText(record.fastmossInfluencerUrl);
      if (influencerHtml) {
        enriched = utils.enrichRecordWithText(enriched, influencerHtml);
      }
    }

    if (!enriched.tiktokVideoUrl && record.fastmossVideoUrl) {
      const videoHtml = await fetchDetailText(record.fastmossVideoUrl);
      if (videoHtml) {
        enriched = utils.enrichRecordWithText(enriched, videoHtml);
      }
    }

    return enriched;
  }

  async function fetchDetailText(url) {
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
      await sleep(120);
      return text;
    } catch (error) {
      detailCache.set(url, '');
      return '';
    }
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
      if (getTableRows().length > 0) {
        return true;
      }

      if (stopRequested) {
        return false;
      }

      await sleep(POLL_MS);
    }

    throw new Error('没有找到可抓取的表格行');
  }

  async function waitForTableChange(previousSignature, timeoutMs) {
    const startedAt = Date.now();
    await sleep(600);

    while (Date.now() - startedAt < timeoutMs) {
      if (stopRequested) {
        return false;
      }

      const currentSignature = getTableSignature();
      if (currentSignature && currentSignature !== previousSignature && getTableRows().length > 0) {
        return true;
      }

      await sleep(POLL_MS);
    }

    return false;
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
