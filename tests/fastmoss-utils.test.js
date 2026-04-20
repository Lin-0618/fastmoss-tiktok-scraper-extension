const test = require('node:test');
const assert = require('node:assert/strict');

const utils = require('../src/fastmoss-utils.js');

test('extractHandle finds creator handles in TikTok URLs and @mentions', () => {
  assert.equal(
    utils.extractHandle('https://www.tiktok.com/@no_limbs_/video/7628418151037881613'),
    'no_limbs_'
  );
  assert.equal(utils.extractHandle('@overtime'), 'overtime');
  assert.equal(utils.extractHandle('达人主页 https://www.tiktok.com/@creator.name'), 'creator.name');
  assert.equal(utils.extractHandle('https://www.tiktok.com/@'), '');
  assert.equal(utils.buildTikTokProfileUrl('https://www.tiktok.com/@'), '');
});

test('extractTikTokVideoUrl normalizes TikTok video URLs from row links', () => {
  assert.equal(
    utils.extractTikTokVideoUrl('https://www.tiktok.com/@taniamonserratlugoh/video/7628461448393461013?is_copy_url=1&is_from_webapp=v1'),
    'https://www.tiktok.com/@taniamonserratlugoh/video/7628461448393461013'
  );
  assert.equal(
    utils.extractTikTokVideoUrl('打开 www.tiktok.com/@creator.name/video/1234567890123456789'),
    'https://www.tiktok.com/@creator.name/video/1234567890123456789'
  );
  assert.equal(utils.extractTikTokVideoUrl('https://www.tiktok.com/@creator.name'), '');
});

test('buildTikTokVideoUrl combines a creator handle and FastMoss video id', () => {
  assert.equal(
    utils.buildTikTokVideoUrl('@taniamonserratlugoh', '7628461448393461013'),
    'https://www.tiktok.com/@taniamonserratlugoh/video/7628461448393461013'
  );
  assert.equal(utils.buildTikTokVideoUrl('', '7628461448393461013'), '');
  assert.equal(utils.buildTikTokVideoUrl('creator', ''), '');
});

test('extractFastMossVideoInfo finds FastMoss video detail URLs and IDs', () => {
  assert.deepEqual(
    utils.extractFastMossVideoInfo([
      'https://www.fastmoss.com/zh/influencer/detail/123',
      'https://www.fastmoss.com/zh/media-source/video/7628461448393461013?foo=bar'
    ]),
    {
      fastmossVideoUrl: 'https://www.fastmoss.com/zh/media-source/video/7628461448393461013?foo=bar',
      fastmossVideoId: '7628461448393461013'
    }
  );
});

test('extractFastMossInfluencerUrl finds FastMoss influencer detail URLs', () => {
  assert.equal(
    utils.extractFastMossInfluencerUrl([
      'https://www.fastmoss.com/zh/influencer/detail/6810999482452726',
      'https://www.fastmoss.com/zh/media-source/video/7628461448393461013'
    ]),
    'https://www.fastmoss.com/zh/influencer/detail/6810999482452726'
  );
});

test('enrichRecordWithText fills missing handles and video URLs from detail HTML', () => {
  const record = utils.buildRecordFromCells({
    page: 1,
    rowIndex: 1,
    sourceUrl: 'https://www.fastmoss.com/zh/media-source/video',
    cellTexts: [
      'Me contra\n时长: 120s',
      'Zulma\n墨西哥\n日用百货',
      '91.93 万',
      '2026-04-14 12:06:37',
      '400.00万'
    ],
    hrefs: [
      'https://www.fastmoss.com/zh/influencer/detail/6810999482452726',
      'https://www.fastmoss.com/zh/media-source/video/7628461448393461013'
    ]
  });

  const enriched = utils.enrichRecordWithText(
    record,
    '达人主页 https://www.tiktok.com/@taniamonserratlugoh'
  );

  assert.equal(enriched.creatorHandle, 'taniamonserratlugoh');
  assert.equal(enriched.tiktokProfileUrl, 'https://www.tiktok.com/@taniamonserratlugoh');
  assert.equal(enriched.tiktokVideoUrl, 'https://www.tiktok.com/@taniamonserratlugoh/video/7628461448393461013');
});

test('buildRecordFromCells maps FastMoss table cells into export fields', () => {
  const record = utils.buildRecordFromCells({
    page: 2,
    rowIndex: 4,
    sourceUrl: 'https://www.fastmoss.com/zh/media-source/video',
    cellTexts: [
      'I love hair da...\n时长: 89s',
      'Briel Adams-Wheatley\n美国\n美妆',
      '528.68 万',
      '2026-04-14 09:18:50',
      '468.00万'
    ],
    hrefs: ['https://www.tiktok.com/@no_limbs_/video/7628418151037881613']
  });

  assert.deepEqual(record, {
    page: 2,
    rowIndex: 4,
    videoTitle: 'I love hair da...',
    duration: '89s',
    creatorName: 'Briel Adams-Wheatley',
    creatorHandle: 'no_limbs_',
    tiktokProfileUrl: 'https://www.tiktok.com/@no_limbs_',
    tiktokVideoUrl: 'https://www.tiktok.com/@no_limbs_/video/7628418151037881613',
    fastmossInfluencerUrl: '',
    fastmossVideoUrl: '',
    fastmossVideoId: '',
    country: '美国',
    category: '美妆',
    followers: '528.68 万',
    publishedAt: '2026-04-14 09:18:50',
    views: '468.00万',
    sourceUrl: 'https://www.fastmoss.com/zh/media-source/video'
  });
});

test('buildRecordFromCells builds TikTok video URLs from handle and FastMoss video IDs', () => {
  const record = utils.buildRecordFromCells({
    page: 1,
    rowIndex: 2,
    sourceUrl: 'https://www.fastmoss.com/zh/media-source/video',
    cellTexts: [
      '.como se conocieron Niklaus y Amy?',
      '@taniamonserratlugoh\n墨西哥\n家具和电器',
      '91.93 万',
      '2026-04-14 12:06:37',
      '400.00万'
    ],
    hrefs: [
      'https://www.fastmoss.com/zh/influencer/detail/6810999482452726',
      'https://www.fastmoss.com/zh/media-source/video/7628461448393461013'
    ]
  });

  assert.equal(record.creatorHandle, 'taniamonserratlugoh');
  assert.equal(record.fastmossInfluencerUrl, 'https://www.fastmoss.com/zh/influencer/detail/6810999482452726');
  assert.equal(record.fastmossVideoId, '7628461448393461013');
  assert.equal(record.fastmossVideoUrl, 'https://www.fastmoss.com/zh/media-source/video/7628461448393461013');
  assert.equal(record.tiktokVideoUrl, 'https://www.tiktok.com/@taniamonserratlugoh/video/7628461448393461013');
});

test('recordsToCsv escapes commas, quotes, and newlines', () => {
  const csv = utils.recordsToCsv([
    {
      page: 1,
      rowIndex: 1,
      videoTitle: 'Hello, "TikTok"\nWorld',
      duration: '28s',
      creatorName: 'Overtime',
      creatorHandle: 'overtime',
      tiktokProfileUrl: 'https://www.tiktok.com/@overtime',
      tiktokVideoUrl: 'https://www.tiktok.com/@overtime/video/7628418151037881613',
      fastmossVideoUrl: 'https://www.fastmoss.com/zh/media-source/video/7628418151037881613',
      fastmossVideoId: '7628418151037881613',
      country: '美国',
      category: '购物与零售',
      followers: '320.3 万',
      publishedAt: '2026-04-16 00:04:51',
      views: '367.00万',
      sourceUrl: 'https://www.fastmoss.com/zh/media-source/video'
    }
  ]);

  assert.match(csv, /^page,rowIndex,videoTitle/);
  assert.match(csv, /tiktokVideoUrl/);
  assert.match(csv, /"Hello, ""TikTok""\nWorld"/);
});

test('recordsToExcelCsv adds a UTF-8 BOM for Chinese text in Excel', () => {
  const csv = utils.recordsToExcelCsv([
    {
      page: 1,
      rowIndex: 1,
      videoTitle: '这是中文标题',
      duration: '28s',
      creatorName: '达人名称',
      creatorHandle: 'creator',
      tiktokProfileUrl: 'https://www.tiktok.com/@creator',
      tiktokVideoUrl: 'https://www.tiktok.com/@creator/video/7628418151037881613',
      country: '美国',
      category: '美妆',
      followers: '320.3 万',
      publishedAt: '2026-04-16 00:04:51',
      views: '367.00万',
      sourceUrl: 'https://www.fastmoss.com/zh/media-source/video'
    }
  ]);

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /这是中文标题/);
  assert.match(csv, /达人名称/);
});

test('recordsToLinkText exports unique TikTok profile links only', () => {
  const records = [
    { tiktokProfileUrl: 'https://www.tiktok.com/@a' },
    { tiktokProfileUrl: 'https://www.tiktok.com/@a' },
    { tiktokProfileUrl: 'https://www.tiktok.com/@b' },
    { tiktokProfileUrl: '' }
  ];

  assert.equal(utils.recordsToLinkText(records), 'https://www.tiktok.com/@a\nhttps://www.tiktok.com/@b');
});

test('recordsToVideoLinkText exports unique TikTok video links only', () => {
  const records = [
    { tiktokVideoUrl: 'https://www.tiktok.com/@a/video/1' },
    { tiktokVideoUrl: 'https://www.tiktok.com/@a/video/1' },
    { tiktokVideoUrl: 'https://www.tiktok.com/@b/video/2' },
    { tiktokVideoUrl: '' }
  ];

  assert.equal(
    utils.recordsToVideoLinkText(records),
    'https://www.tiktok.com/@a/video/1\nhttps://www.tiktok.com/@b/video/2'
  );
});

test('dedupeRecords keeps the first record for each TikTok profile URL', () => {
  const records = [
    { tiktokProfileUrl: 'https://www.tiktok.com/@a', videoTitle: 'first' },
    { tiktokProfileUrl: 'https://www.tiktok.com/@a', videoTitle: 'second' },
    { tiktokProfileUrl: 'https://www.tiktok.com/@b', videoTitle: 'third' }
  ];

  assert.deepEqual(utils.dedupeRecords(records).map((record) => record.videoTitle), ['first', 'third']);
});
