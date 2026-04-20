(function initFastMossUtils(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.FastMossUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : undefined, function createFastMossUtils() {
  const CSV_COLUMNS = [
    'page',
    'rowIndex',
    'videoTitle',
    'duration',
    'creatorName',
    'creatorHandle',
    'tiktokProfileUrl',
    'tiktokVideoUrl',
    'fastmossInfluencerUrl',
    'fastmossVideoUrl',
    'fastmossVideoId',
    'country',
    'category',
    'followers',
    'publishedAt',
    'views',
    'sourceUrl'
  ];

  function normalizeWhitespace(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\f\v]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\s+\n/g, '\n')
      .trim();
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function splitLines(value) {
    return normalizeWhitespace(value)
      .split('\n')
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);
  }

  function extractHandle(value) {
    const text = String(value || '');
    const directUrlMatch = text.match(/tiktok\.com\/@([A-Za-z0-9._-]{2,32})(?:[/?#\s]|$)/i);
    if (directUrlMatch) {
      return cleanHandle(directUrlMatch[1]);
    }

    const atMatch = text.match(/(^|[^A-Za-z0-9._-])@([A-Za-z0-9._-]{2,32})(?:[^A-Za-z0-9._-]|$)/);
    if (atMatch) {
      return cleanHandle(atMatch[2]);
    }

    return '';
  }

  function cleanHandle(value) {
    const raw = String(value || '').trim();
    if (/^https?:\/\//i.test(raw)) {
      return extractHandle(raw);
    }

    return raw
      .replace(/^@+/, '')
      .replace(/[/?#].*$/, '')
      .replace(/[^A-Za-z0-9._-]/g, '')
      .slice(0, 32);
  }

  function buildTikTokProfileUrl(handle) {
    const clean = cleanHandle(handle);
    return clean ? `https://www.tiktok.com/@${clean}` : '';
  }

  function buildTikTokVideoUrl(handle, videoId) {
    const clean = cleanHandle(handle);
    const cleanVideoId = cleanVideoIdValue(videoId);
    return clean && cleanVideoId ? `https://www.tiktok.com/@${clean}/video/${cleanVideoId}` : '';
  }

  function extractTikTokVideoUrl(value) {
    const text = String(value || '');
    const match = text.match(/(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]{2,32})\/video\/([0-9]{8,30})(?:[/?#\s]|$)/i);
    if (!match) {
      return '';
    }

    return buildTikTokVideoUrl(match[1], match[2]);
  }

  function extractFastMossVideoInfo(values) {
    const list = Array.isArray(values) ? values : [values];

    for (const value of list) {
      const text = String(value || '');
      const match = text.match(/https?:\/\/www\.fastmoss\.com\/[^\s"'<>]*\/media-source\/video\/([0-9]{8,30})(?:[^\s"'<>]*)?/i);
      if (match) {
        return {
          fastmossVideoUrl: text.match(/https?:\/\/www\.fastmoss\.com\/[^\s"'<>]*\/media-source\/video\/[0-9]{8,30}(?:[^\s"'<>]*)?/i)[0],
          fastmossVideoId: match[1]
        };
      }
    }

    return {
      fastmossVideoUrl: '',
      fastmossVideoId: ''
    };
  }

  function extractFastMossInfluencerUrl(values) {
    const list = Array.isArray(values) ? values : [values];

    for (const value of list) {
      const text = String(value || '');
      const match = text.match(/https?:\/\/www\.fastmoss\.com\/[^\s"'<>]*\/influencer\/detail\/[A-Za-z0-9_-]+(?:[^\s"'<>]*)?/i);
      if (match) {
        return match[0];
      }
    }

    return '';
  }

  function cleanVideoIdValue(value) {
    const match = String(value || '').match(/[0-9]{8,30}/);
    return match ? match[0] : '';
  }

  function parseDuration(videoText) {
    const text = normalizeWhitespace(videoText);
    const labelMatch = text.match(/(?:时长|duration)\s*[:：]\s*([0-9]{1,2}(?::[0-9]{2}){1,2}|[0-9]+(?:\.\d+)?\s*(?:s|m|h|秒|分钟|分)?)/i);
    if (labelMatch) {
      return normalizeWhitespace(labelMatch[1]);
    }

    const compactMatch = text.match(/\b([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)\b/);
    return compactMatch ? compactMatch[1] : '';
  }

  function parseVideoTitle(videoText) {
    const duration = parseDuration(videoText);
    const lines = splitLines(videoText)
      .filter((line) => !/^AD$/i.test(line))
      .filter((line) => !/(?:时长|duration)\s*[:：]/i.test(line))
      .filter((line) => line !== duration);

    return lines[0] || '';
  }

  function parseCreatorInfo(creatorText) {
    const lines = splitLines(creatorText);
    const handleFromText = extractHandle(creatorText);
    const nonHandleLines = lines.filter((line) => !extractHandle(line));
    const creatorName = nonHandleLines[0] || lines[0] || '';
    const country = nonHandleLines[1] || '';
    const category = nonHandleLines.slice(2).join(' / ');

    return {
      creatorName,
      creatorHandle: handleFromText,
      country,
      category
    };
  }

  function buildRecordFromCells(input) {
    const cellTexts = Array.isArray(input && input.cellTexts) ? input.cellTexts : [];
    const hrefs = Array.isArray(input && input.hrefs) ? input.hrefs : [];
    const hrefText = hrefs.join('\n');
    const allText = [hrefText, cellTexts.join('\n')].join('\n');
    const creatorInfo = parseCreatorInfo(cellTexts[1] || '');
    const handle = creatorInfo.creatorHandle || extractHandle(hrefText) || extractHandle(cellTexts.join('\n'));
    const fastmossInfluencerUrl = extractFastMossInfluencerUrl(hrefs);
    const fastmossVideoInfo = extractFastMossVideoInfo(hrefs);
    const tiktokVideoUrl = extractTikTokVideoUrl(allText) || buildTikTokVideoUrl(handle, fastmossVideoInfo.fastmossVideoId);

    return {
      page: Number(input && input.page) || 1,
      rowIndex: Number(input && input.rowIndex) || 1,
      videoTitle: parseVideoTitle(cellTexts[0] || ''),
      duration: parseDuration(cellTexts[0] || ''),
      creatorName: creatorInfo.creatorName,
      creatorHandle: handle,
      tiktokProfileUrl: buildTikTokProfileUrl(handle),
      tiktokVideoUrl,
      fastmossInfluencerUrl,
      fastmossVideoUrl: fastmossVideoInfo.fastmossVideoUrl,
      fastmossVideoId: fastmossVideoInfo.fastmossVideoId,
      country: creatorInfo.country,
      category: creatorInfo.category,
      followers: normalizeWhitespace(cellTexts[2] || ''),
      publishedAt: normalizeWhitespace(cellTexts[3] || ''),
      views: normalizeWhitespace(cellTexts[4] || ''),
      sourceUrl: normalizeWhitespace((input && input.sourceUrl) || '')
    };
  }

  function csvEscape(value) {
    const text = String(value == null ? '' : value);
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
  }

  function recordsToCsv(records) {
    const rows = [CSV_COLUMNS.join(',')];

    for (const record of records || []) {
      rows.push(CSV_COLUMNS.map((column) => csvEscape(record[column])).join(','));
    }

    return rows.join('\n');
  }

  function recordsToExcelCsv(records) {
    return `\ufeff${recordsToCsv(records)}`;
  }

  function recordsToLinkText(records) {
    return unique((records || []).map((record) => record && record.tiktokProfileUrl)).join('\n');
  }

  function enrichRecordWithText(record, text) {
    const detailHandle = extractHandle(text);
    const detailVideoUrl = extractTikTokVideoUrl(text);
    const handle = record.creatorHandle || detailHandle;
    const tiktokVideoUrl = record.tiktokVideoUrl ||
      detailVideoUrl ||
      buildTikTokVideoUrl(handle, record.fastmossVideoId);

    return Object.assign({}, record, {
      creatorHandle: handle,
      tiktokProfileUrl: record.tiktokProfileUrl || buildTikTokProfileUrl(handle),
      tiktokVideoUrl
    });
  }

  function recordsToVideoLinkText(records) {
    return unique((records || []).map((record) => record && record.tiktokVideoUrl)).join('\n');
  }

  function dedupeRecords(records) {
    const seen = new Set();
    const output = [];

    for (const record of records || []) {
      const key = record && record.tiktokProfileUrl
        ? record.tiktokProfileUrl
        : `${record && record.page}:${record && record.rowIndex}:${record && record.videoTitle}`;

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      output.push(record);
    }

    return output;
  }

  return {
    CSV_COLUMNS,
    normalizeWhitespace,
    extractHandle,
    extractTikTokVideoUrl,
    extractFastMossVideoInfo,
    extractFastMossInfluencerUrl,
    buildTikTokProfileUrl,
    buildTikTokVideoUrl,
    buildRecordFromCells,
    enrichRecordWithText,
    recordsToCsv,
    recordsToExcelCsv,
    recordsToLinkText,
    recordsToVideoLinkText,
    dedupeRecords
  };
});
