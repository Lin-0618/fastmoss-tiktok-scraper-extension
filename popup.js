(function initPopup() {
  const utils = window.FastMossUtils;
  const elements = {
    statusBadge: document.getElementById('statusBadge'),
    maxPages: document.getElementById('maxPages'),
    startButton: document.getElementById('startButton'),
    stopButton: document.getElementById('stopButton'),
    copyCsvButton: document.getElementById('copyCsvButton'),
    downloadCsvButton: document.getElementById('downloadCsvButton'),
    downloadVideoTxtButton: document.getElementById('downloadVideoTxtButton'),
    downloadTxtButton: document.getElementById('downloadTxtButton'),
    currentPage: document.getElementById('currentPage'),
    recordCount: document.getElementById('recordCount'),
    message: document.getElementById('message'),
    preview: document.getElementById('preview')
  };

  let latestState = {
    status: 'idle',
    running: false,
    currentPage: '-',
    records: [],
    message: '打开 FastMoss 视频页后点击开始。'
  };
  let pollTimer = null;

  document.addEventListener('DOMContentLoaded', () => {
    elements.startButton.addEventListener('click', startScrape);
    elements.stopButton.addEventListener('click', stopScrape);
    elements.copyCsvButton.addEventListener('click', copyCsv);
    elements.downloadCsvButton.addEventListener('click', () => downloadFile('fastmoss-tiktok-data.csv', getExcelCsv(), 'text/csv;charset=utf-8'));
    elements.downloadVideoTxtButton.addEventListener('click', () => downloadFile('fastmoss-tiktok-video-links.txt', getVideoLinksText(), 'text/plain;charset=utf-8'));
    elements.downloadTxtButton.addEventListener('click', () => downloadFile('fastmoss-tiktok-links.txt', getLinksText(), 'text/plain;charset=utf-8'));

    refreshState();
    pollTimer = window.setInterval(refreshState, 1000);
  });

  window.addEventListener('unload', () => {
    if (pollTimer) {
      window.clearInterval(pollTimer);
    }
  });

  async function startScrape() {
    const maxPages = Math.max(1, Math.min(500, Number(elements.maxPages.value) || 50));
    try {
      await sendCommand('FM_SCRAPE_START', { maxPages });
      await refreshState();
    } catch (error) {
      setLocalMessage(formatConnectionError(error));
    }
  }

  async function stopScrape() {
    try {
      await sendCommand('FM_SCRAPE_STOP');
      await refreshState();
    } catch (error) {
      setLocalMessage(formatConnectionError(error));
    }
  }

  async function copyCsv() {
    const csv = getCsv();
    if (!csv || latestState.records.length === 0) {
      setLocalMessage('还没有可复制的数据。');
      return;
    }

    await navigator.clipboard.writeText(csv);
    setLocalMessage('CSV 已复制到剪贴板。');
  }

  function getCsv() {
    return utils.recordsToCsv(latestState.records || []);
  }

  function getExcelCsv() {
    return utils.recordsToExcelCsv(latestState.records || []);
  }

  function getLinksText() {
    return utils.recordsToLinkText(latestState.records || []);
  }

  function getVideoLinksText() {
    return utils.recordsToVideoLinkText(latestState.records || []);
  }

  async function refreshState() {
    try {
      const response = await sendCommand('FM_SCRAPE_GET_STATE');
      if (response && response.state) {
        latestState = response.state;
        render();
      }
    } catch (error) {
      latestState = {
        status: 'error',
        running: false,
        currentPage: '-',
        records: [],
        message: '请先打开 FastMoss 页面，或刷新页面后再试。'
      };
      render();
    }
  }

  function render() {
    const records = latestState.records || [];
    elements.currentPage.textContent = latestState.currentPage || '-';
    elements.recordCount.textContent = String(records.length);
    elements.message.textContent = latestState.message || '';
    elements.preview.value = buildPreviewText();

    elements.statusBadge.textContent = statusLabel(latestState.status);
    elements.statusBadge.className = `badge ${latestState.status || 'idle'}`;

    elements.startButton.disabled = latestState.running;
    elements.stopButton.disabled = !latestState.running;
    elements.copyCsvButton.disabled = records.length === 0;
    elements.downloadCsvButton.disabled = records.length === 0;
    elements.downloadVideoTxtButton.disabled = getVideoLinksText().length === 0;
    elements.downloadTxtButton.disabled = records.length === 0;
  }

  function buildPreviewText() {
    const videoLinks = getVideoLinksText();
    const profileLinks = getLinksText();

    if (videoLinks && profileLinks) {
      return `视频链接:\n${videoLinks}\n\n达人链接:\n${profileLinks}`;
    }

    return videoLinks || profileLinks;
  }

  function statusLabel(status) {
    const labels = {
      idle: '待机',
      running: '运行中',
      complete: '完成',
      stopped: '已停止',
      error: '错误'
    };

    return labels[status] || '待机';
  }

  function setLocalMessage(message) {
    latestState = Object.assign({}, latestState, { message });
    render();
  }

  async function sendCommand(type, payload) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.id) {
      throw new Error('No active tab');
    }

    const message = Object.assign({ type }, payload || {});

    try {
      return await sendMessageToTab(tab.id, message);
    } catch (error) {
      if (isMissingReceiver(error) && isFastMossTab(tab)) {
        await injectContentScripts(tab.id);
        return sendMessageToTab(tab.id, message);
      }

      throw error;
    }
  }

  function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }

  async function injectContentScripts(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/fastmoss-utils.js']
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    await sleep(150);
  }

  function isMissingReceiver(error) {
    return /receiving end does not exist|could not establish connection/i.test(error && error.message);
  }

  function isFastMossTab(tab) {
    return /^https:\/\/www\.fastmoss\.com\//.test(tab && tab.url || '');
  }

  function formatConnectionError(error) {
    if (isMissingReceiver(error)) {
      return '页面脚本还没连接上，请确认当前标签页是 FastMoss 页面，然后再点一次开始。';
    }

    return `操作失败：${error.message}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function downloadFile(filename, content, mimeType) {
    if (!content || latestState.records.length === 0) {
      setLocalMessage('还没有可下载的数据。');
      return;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
