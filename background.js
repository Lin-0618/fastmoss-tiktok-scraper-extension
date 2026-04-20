importScripts('src/fastmoss-runtime.js');

const runtimeApi = self.FastMossRuntime;
const TARGET_URL = 'https://www.fastmoss.com/zh/media-source/video';
const STATE_POLL_MS = 1000;
const AUTO_RESUME_POLL_MS = 5000;
const CHALLENGE_NOTIFICATION_ID = 'fastmoss-challenge-detected';

let jobState = runtimeApi.buildJobState({
  message: '等待开始。',
  currentPage: '-'
});
let statePollTimer = null;
let autoResumeTimer = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: error.message, state: jobState }));

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (jobState.managedTabId === tabId && isJobActive(jobState.status)) {
    updateJobState({
      status: 'error',
      running: false,
      autoResumeActive: false,
      managedTabId: null,
      message: '抓取标签页被关闭，任务已停止。'
    });
    stopPolling();
  }
});

async function handleMessage(message) {
  if (message.type === 'BG_GET_STATE') {
    await syncStateFromTab();
    return { ok: true, state: jobState };
  }

  if (message.type === 'BG_START') {
    await startJob(message);
    return { ok: true, state: jobState };
  }

  if (message.type === 'BG_STOP') {
    await stopJob();
    return { ok: true, state: jobState };
  }

  if (message.type === 'BG_RESUME') {
    await resumeJob();
    return { ok: true, state: jobState };
  }

  return { ok: false, error: `Unknown message type: ${message.type}`, state: jobState };
}

async function startJob(message) {
  await stopJob({ preserveState: false, silent: true });

  const config = {
    maxPages: Math.max(1, Math.min(500, Number(message.maxPages) || 50)),
    speedProfile: message.speedProfile || 'slow',
    backgroundMode: message.backgroundMode !== false,
    detailEnrichmentEnabled: message.detailEnrichmentEnabled !== false,
    autoCloseOnComplete: message.autoCloseOnComplete !== false
  };

  const tab = config.backgroundMode
    ? await createManagedBackgroundTab()
    : await getActiveFastMossTab();

  updateJobState({
    status: 'running',
    running: true,
    managedTabId: tab.id,
    currentPage: '-',
    records: [],
    pauseReason: '',
    autoResumeActive: false,
    speedProfile: config.speedProfile,
    detailEnrichmentEnabled: config.detailEnrichmentEnabled,
    message: '正在准备抓取页面。'
  });

  await waitForTabReady(tab.id, TARGET_URL);
  await ensureContentScripts(tab.id);
  await sendMessageToTab(tab.id, Object.assign({ type: 'FM_SCRAPE_START' }, config));
  startPolling();
}

async function stopJob(options) {
  const settings = Object.assign({ preserveState: true, silent: false }, options || {});

  if (jobState.managedTabId) {
    try {
      await sendMessageToTab(jobState.managedTabId, { type: 'FM_SCRAPE_STOP' });
    } catch (_error) {
      // Ignore tab messaging failures during shutdown.
    }
  }

  stopPolling();

  if (!settings.silent) {
    updateJobState({
      status: 'stopped',
      running: false,
      autoResumeActive: false,
      message: '任务已停止。'
    });
  } else if (!settings.preserveState) {
    jobState = runtimeApi.buildJobState({
      message: '等待开始。',
      currentPage: '-'
    });
    syncVisualState();
  }
}

async function resumeJob() {
  if (!jobState.managedTabId) {
    throw new Error('当前没有可恢复的抓取任务。');
  }

  await ensureContentScripts(jobState.managedTabId);
  await sendMessageToTab(jobState.managedTabId, { type: 'FM_SCRAPE_RESUME' });
  updateJobState({
    message: '正在尝试恢复抓取。',
    autoResumeActive: false
  });
  startPolling();
}

function startPolling() {
  stopPolling();

  statePollTimer = setInterval(() => {
    syncStateFromTab().catch(() => null);
  }, STATE_POLL_MS);
}

function stopPolling() {
  if (statePollTimer) {
    clearInterval(statePollTimer);
    statePollTimer = null;
  }

  if (autoResumeTimer) {
    clearInterval(autoResumeTimer);
    autoResumeTimer = null;
  }
}

async function syncStateFromTab() {
  if (!jobState.managedTabId) {
    return;
  }

  try {
    const response = await sendMessageToTab(jobState.managedTabId, { type: 'FM_SCRAPE_GET_STATE' });
    if (!response || !response.state) {
      return;
    }

    jobState = runtimeApi.buildJobState(Object.assign({}, jobState, response.state, {
      managedTabId: jobState.managedTabId,
      speedProfile: jobState.speedProfile || response.state.speedProfile,
      detailEnrichmentEnabled: jobState.detailEnrichmentEnabled
    }));

    if (jobState.status === 'paused_challenge') {
      startAutoResumePolling();
      return;
    }

    if (!isJobActive(jobState.status)) {
      stopPolling();
      if (jobState.status === 'complete' && response.state.autoCloseOnComplete && jobState.managedTabId) {
        try {
          await chrome.tabs.remove(jobState.managedTabId);
        } catch (_error) {
          // Ignore tab close errors.
        }
      }
    }
  } catch (error) {
    if (jobState.status === 'complete' || jobState.status === 'stopped') {
      stopPolling();
      return;
    }

    updateJobState({
      status: 'error',
      running: false,
      autoResumeActive: false,
      message: `后台抓取中断：${error.message}`
    });
    stopPolling();
  }
}

function startAutoResumePolling() {
  if (autoResumeTimer) {
    return;
  }

  updateJobState({
    autoResumeActive: true,
    message: jobState.message || '检测到验证，等待页面恢复。'
  });

  autoResumeTimer = setInterval(async () => {
    if (!jobState.managedTabId) {
      stopPolling();
      return;
    }

    try {
      await sendMessageToTab(jobState.managedTabId, { type: 'FM_SCRAPE_RESUME_CHECK' });
      await syncStateFromTab();

      if (jobState.status !== 'paused_challenge') {
        clearInterval(autoResumeTimer);
        autoResumeTimer = null;
      }
    } catch (_error) {
      // Leave the timer running; the tab may still be navigating.
    }
  }, AUTO_RESUME_POLL_MS);
}

async function createManagedBackgroundTab() {
  return chrome.tabs.create({
    url: TARGET_URL,
    active: false
  });
}

async function getActiveFastMossTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id || !tab.url || !tab.url.startsWith('https://www.fastmoss.com/')) {
    throw new Error('当前活动页不是 FastMoss 页面。');
  }

  return tab;
}

async function waitForTabReady(tabId, expectedUrl) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && tab.url && tab.url.startsWith(expectedUrl)) {
      return;
    }

    await sleep(300);
  }

  throw new Error('后台标签页加载超时。');
}

async function ensureContentScripts(tabId) {
  try {
    await sendMessageToTab(tabId, { type: 'FM_SCRAPE_GET_STATE' });
    return;
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/fastmoss-runtime.js', 'src/fastmoss-utils.js', 'content.js']
    });
    await sleep(250);
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

function updateJobState(patch) {
  const previousStatus = jobState.status;
  const previousPauseReason = jobState.pauseReason;
  jobState = runtimeApi.buildJobState(Object.assign({}, jobState, patch));
  syncVisualState();

  if (jobState.status === 'paused_challenge' && previousStatus !== 'paused_challenge') {
    notifyChallenge(jobState.pauseReason || previousPauseReason || 'challenge');
    return;
  }

  if (previousStatus === 'paused_challenge' && jobState.status !== 'paused_challenge') {
    clearChallengeNotification();
  }
}

function isJobActive(status) {
  return status === 'running' || status === 'paused_challenge' || status === 'paused_manual';
}

function syncVisualState() {
  const badge = getBadgeState(jobState.status);
  chrome.action.setBadgeText({ text: badge.text });
  chrome.action.setBadgeBackgroundColor({ color: badge.color });
}

function getBadgeState(status) {
  if (status === 'running') {
    return { text: 'RUN', color: '#176735' };
  }

  if (status === 'paused_challenge') {
    return { text: 'VERIFY', color: '#a0182a' };
  }

  if (status === 'error') {
    return { text: 'ERR', color: '#a0182a' };
  }

  if (status === 'complete') {
    return { text: 'OK', color: '#176735' };
  }

  return { text: '', color: '#455065' };
}

function notifyChallenge(reason) {
  chrome.notifications.create(CHALLENGE_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: 'icon-128.png',
    title: 'FastMoss 需要验证',
    message: buildChallengeMessage(reason),
    priority: 2
  });
}

function buildChallengeMessage(reason) {
  if (/cloudflare/i.test(reason || '')) {
    return '检测到 Cloudflare 验证。请完成验证后，扩展会自动继续抓取。';
  }

  return '检测到验证码或验证页面。请完成验证后，扩展会自动继续抓取。';
}

function clearChallengeNotification() {
  chrome.notifications.clear(CHALLENGE_NOTIFICATION_ID, () => undefined);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
