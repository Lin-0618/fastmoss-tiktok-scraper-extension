const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../src/fastmoss-runtime.js');

test('getSpeedProfile returns bounded delay ranges for known profiles', () => {
  const slow = runtime.getSpeedProfile('slow');
  const verySlow = runtime.getSpeedProfile('very_slow');

  assert.equal(slow.name, 'slow');
  assert.equal(verySlow.name, 'very_slow');
  assert.ok(slow.initialDelayMs.min < slow.initialDelayMs.max);
  assert.ok(verySlow.initialDelayMs.min > slow.initialDelayMs.min);
  assert.ok(verySlow.longPauseEveryPages < slow.longPauseEveryPages);
  assert.ok(verySlow.longPauseMs.max > slow.longPauseMs.max);
});

test('isChallengeText detects common challenge and captcha markers', () => {
  assert.equal(runtime.isChallengeText('Please complete the captcha to continue'), true);
  assert.equal(runtime.isChallengeText('Verify you are human before continuing'), true);
  assert.equal(runtime.isChallengeText('请完成验证后继续访问'), true);
  assert.equal(runtime.isChallengeText('视频内容 达人信息 发布时间'), false);
});

test('buildJobState creates a stable default shape', () => {
  const state = runtime.buildJobState({ status: 'running', currentPage: 8 });

  assert.equal(state.status, 'running');
  assert.equal(state.currentPage, 8);
  assert.deepEqual(state.records, []);
  assert.equal(state.pauseReason, '');
  assert.equal(state.autoResumeActive, false);
  assert.equal(typeof state.updatedAt, 'number');
});

test('transitionJobState pauses on challenge without dropping progress', () => {
  const state = runtime.buildJobState({
    status: 'running',
    currentPage: 12,
    records: [{ rowIndex: 1 }, { rowIndex: 2 }]
  });

  const paused = runtime.transitionJobState(state, {
    type: 'challenge_detected',
    reason: 'cloudflare'
  });

  assert.equal(paused.status, 'paused_challenge');
  assert.equal(paused.currentPage, 12);
  assert.equal(paused.records.length, 2);
  assert.equal(paused.pauseReason, 'cloudflare');
  assert.equal(paused.autoResumeActive, true);
});

test('transitionJobState resumes from challenge while preserving progress', () => {
  const paused = runtime.buildJobState({
    status: 'paused_challenge',
    currentPage: 12,
    records: [{ rowIndex: 1 }, { rowIndex: 2 }],
    pauseReason: 'cloudflare',
    autoResumeActive: true
  });

  const resumed = runtime.transitionJobState(paused, {
    type: 'resume_requested'
  });

  assert.equal(resumed.status, 'running');
  assert.equal(resumed.currentPage, 12);
  assert.equal(resumed.records.length, 2);
  assert.equal(resumed.pauseReason, '');
  assert.equal(resumed.autoResumeActive, false);
});
