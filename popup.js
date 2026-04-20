(function initPopup() {
  const utils = window.FastMossUtils;
  const runtimeApi = window.FastMossRuntime;
  const elements = {
    statusBadge: document.getElementById('statusBadge'),
    maxPages: document.getElementById('maxPages'),
    speedProfile: document.getElementById('speedProfile'),
    backgroundMode: document.getElementById('backgroundMode'),
    detailEnrichmentEnabled: document.getElementById('detailEnrichmentEnabled'),
    startButton: document.getElementById('startButton'),
    stopButton: document.getElementById('stopButton'),
    resumeButton: document.getElementById('resumeButton'),
    copyCsvButton: document.getElementById('copyCsvButton'),
    downloadCsvButton: document.getElementById('downloadCsvButton'),
    downloadVideoTxtButton: document.getElementById('downloadVideoTxtButton'),
    downloadTxtButton: document.getElementById('downloadTxtButton'),
    currentPage: document.getElementById('currentPage'),
    recordCount: document.getElementById('recordCount'),
    message: document.getElementById('message'),
    preview: document.getElementById('preview')
  };

  let latestState = runtimeApi.buildJobState({
    currentPage: '-',
    message: '点击开始后，扩展会在后台标签页执行抓取。'
  });
  let pollTimer = null;

  document.addEventListener('DOMContentLoaded', () => {
    elements.startButton.addEventListener('click', startScrape);
    elements.stopButton.addEventListener('click', stopScrape);
    elements.resumeButton.addEventListener('click', resumeScrape);
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
      const response = await sendBackgroundMessage({
        type: 'BG_START',
        maxPages,
        speedProfile: elements.speedProfile.value,
        backgroundMode: elements.backgroundMode.checked,
        detailEnrichmentEnabled: elements.detailEnrichmentEnabled.checked
      });

      latestState = runtimeApi.buildJobState(response.state);
      render();
    } catch (error) {
      setLocalMessage(`启动失败：${error.message}`);
    }
  }

  async function stopScrape() {
    try {
      const response = await sendBackgroundMessage({ type: 'BG_STOP' });
      latestState = runtimeApi.buildJobState(response.state);
      render();
    } catch (error) {
      setLocalMessage(`停止失败：${error.message}`);
    }
  }

  async function resumeScrape() {
    try {
      const response = await sendBackgroundMessage({ type: 'BG_RESUME' });
      latestState = runtimeApi.buildJobState(response.state);
      render();
    } catch (error) {
      setLocalMessage(`恢复失败：${error.message}`);
    }
  }

  async function refreshState() {
    try {
      const response = await sendBackgroundMessage({ type: 'BG_GET_STATE' });
      if (response && response.state) {
        latestState = runtimeApi.buildJobState(response.state);
        render();
      }
    } catch (_error) {
      latestState = runtimeApi.buildJobState({
        status: 'error',
        currentPage: '-',
        records: [],
        message: '后台控制器未响应，请重载扩展后重试。'
      });
      render();
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

  function render() {
    const records = latestState.records || [];
    elements.currentPage.textContent = latestState.currentPage || '-';
    elements.recordCount.textContent = String(records.length);
    elements.message.textContent = buildStatusMessage();
    elements.preview.value = buildPreviewText();

    elements.statusBadge.textContent = statusLabel(latestState.status);
    elements.statusBadge.className = `badge ${badgeClassName(latestState.status)}`;

    elements.startButton.disabled = latestState.running;
    elements.stopButton.disabled = !latestState.running && latestState.status !== 'paused_challenge';
    elements.resumeButton.disabled = latestState.status !== 'paused_challenge' && latestState.status !== 'paused_manual';
    elements.copyCsvButton.disabled = records.length === 0;
    elements.downloadCsvButton.disabled = records.length === 0;
    elements.downloadVideoTxtButton.disabled = getVideoLinksText().length === 0;
    elements.downloadTxtButton.disabled = records.length === 0;
  }

  function buildStatusMessage() {
    if (latestState.status === 'paused_challenge') {
      const suffix = latestState.autoResumeActive ? '扩展会自动检查页面恢复情况。' : '请完成验证后点击继续抓取。';
      return `${latestState.message || '检测到验证页面。'} ${suffix}`;
    }

    return latestState.message || '等待开始。';
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
      paused_challenge: '待验证',
      paused_manual: '已暂停',
      complete: '完成',
      stopped: '已停止',
      error: '错误'
    };

    return labels[status] || '待机';
  }

  function badgeClassName(status) {
    if (status === 'paused_challenge' || status === 'paused_manual') {
      return 'running';
    }

    return status || 'idle';
  }

  function setLocalMessage(message) {
    latestState = runtimeApi.buildJobState(Object.assign({}, latestState, { message }));
    render();
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

  function sendBackgroundMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        if (!response || response.ok === false) {
          reject(new Error((response && response.error) || '后台操作失败'));
          return;
        }

        resolve(response);
      });
    });
  }
})();
