(function initFastMossRuntime(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.FastMossRuntime = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function createFastMossRuntime() {
  const SPEED_PROFILES = {
    slow: {
      name: 'slow',
      initialDelayMs: { min: 1800, max: 3200 },
      rowGapMs: { min: 250, max: 700 },
      nextPageDelayMs: { min: 1200, max: 2600 },
      postPageLoadDelayMs: { min: 1800, max: 3600 },
      recoveryDelayMs: { min: 5000, max: 9000 },
      longPauseEveryPages: 4,
      longPauseMs: { min: 3500, max: 8000 }
    },
    very_slow: {
      name: 'very_slow',
      initialDelayMs: { min: 3200, max: 5200 },
      rowGapMs: { min: 600, max: 1200 },
      nextPageDelayMs: { min: 2200, max: 4200 },
      postPageLoadDelayMs: { min: 2800, max: 5200 },
      recoveryDelayMs: { min: 8000, max: 12000 },
      longPauseEveryPages: 3,
      longPauseMs: { min: 6000, max: 12000 }
    }
  };

  const CHALLENGE_PATTERNS = [
    /verify you are human/i,
    /captcha/i,
    /challenge/i,
    /cloudflare/i,
    /请完成验证/,
    /验证后继续/,
    /安全验证/
  ];

  function getSpeedProfile(profileName) {
    return SPEED_PROFILES[profileName] || SPEED_PROFILES.slow;
  }

  function isChallengeText(text) {
    const value = String(text || '');
    return CHALLENGE_PATTERNS.some((pattern) => pattern.test(value));
  }

  function buildJobState(partial) {
    const input = partial || {};
    return {
      status: input.status || 'idle',
      running: Boolean(input.running || input.status === 'running'),
      currentPage: input.currentPage || 0,
      records: Array.isArray(input.records) ? input.records.slice() : [],
      message: input.message || '',
      pauseReason: input.pauseReason || '',
      autoResumeActive: Boolean(input.autoResumeActive),
      managedTabId: input.managedTabId || null,
      speedProfile: input.speedProfile || 'slow',
      detailEnrichmentEnabled: input.detailEnrichmentEnabled !== false,
      updatedAt: input.updatedAt || Date.now()
    };
  }

  function transitionJobState(state, event) {
    const current = buildJobState(state);
    const next = Object.assign({}, current, {
      updatedAt: Date.now()
    });

    if (!event || !event.type) {
      return next;
    }

    if (event.type === 'challenge_detected') {
      next.status = 'paused_challenge';
      next.running = false;
      next.pauseReason = event.reason || 'challenge';
      next.autoResumeActive = true;
      return next;
    }

    if (event.type === 'resume_requested') {
      next.status = 'running';
      next.running = true;
      next.pauseReason = '';
      next.autoResumeActive = false;
      return next;
    }

    if (event.type === 'stop_requested') {
      next.status = 'stopped';
      next.running = false;
      next.autoResumeActive = false;
      return next;
    }

    return next;
  }

  return {
    SPEED_PROFILES,
    getSpeedProfile,
    isChallengeText,
    buildJobState,
    transitionJobState
  };
});
