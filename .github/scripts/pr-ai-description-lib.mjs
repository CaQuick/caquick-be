import path from 'node:path';

export const MARKER_START = '<!-- pr-ai-summary:start -->';
export const MARKER_END = '<!-- pr-ai-summary:end -->';

export const DEFAULT_EXCLUDE_GLOBS = [
  'yarn.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  '**/*.snap',
  'dist/**',
  'coverage/**',
  '**/*.map',
];

const IMPORTANCE_VALUES = new Set(['low', 'medium', 'high']);
const IMPACT_VALUES = new Set(['low', 'medium', 'high']);
const IMPACT_KEYS = [
  'api',
  'db',
  'security',
  'performance',
  'operations',
  'tests',
];

export const AI_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'changes', 'impact', 'checklist', 'risks', 'labels'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'description', 'importance'],
        properties: {
          area: { type: 'string' },
          description: { type: 'string' },
          importance: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
          },
        },
      },
    },
    impact: {
      type: 'object',
      additionalProperties: false,
      required: IMPACT_KEYS,
      properties: {
        api: { type: 'string', enum: ['low', 'medium', 'high'] },
        db: { type: 'string', enum: ['low', 'medium', 'high'] },
        security: { type: 'string', enum: ['low', 'medium', 'high'] },
        performance: { type: 'string', enum: ['low', 'medium', 'high'] },
        operations: { type: 'string', enum: ['low', 'medium', 'high'] },
        tests: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
    },
    checklist: {
      type: 'array',
      items: { type: 'string' },
    },
    risks: {
      type: 'array',
      items: { type: 'string' },
    },
    labels: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

function normalizePath(filePath) {
  return filePath.replaceAll('\\\\', '/').replace(/^\.\//, '');
}

function escapeRegexCharacter(char) {
  if (/[-/\\^$*+?.()|[\]{}]/.test(char)) {
    return `\\${char}`;
  }

  return char;
}

function globToRegExp(globPattern) {
  const pattern = normalizePath(globPattern.trim());
  let regexSource = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === '*') {
      const nextChar = pattern[index + 1];

      if (nextChar === '*') {
        const trailingSlash = pattern[index + 2] === '/';

        if (trailingSlash) {
          regexSource += '(?:.*\\/)?';
          index += 2;
        } else {
          regexSource += '.*';
          index += 1;
        }

        continue;
      }

      regexSource += '[^/]*';
      continue;
    }

    if (char === '?') {
      regexSource += '[^/]';
      continue;
    }

    regexSource += escapeRegexCharacter(char);
  }

  regexSource += '$';

  return new RegExp(regexSource);
}

export function parseAdditionalExcludeGlobs(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return [];
  }

  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function buildExcludeGlobs(rawValue) {
  return [...DEFAULT_EXCLUDE_GLOBS, ...parseAdditionalExcludeGlobs(rawValue)];
}

export function createExcludeMatcher(globs) {
  const patterns = globs
    .map((globItem) => globItem.trim())
    .filter((globItem) => globItem.length > 0)
    .map((globItem) => globToRegExp(globItem));

  return (filePath) => {
    const normalized = normalizePath(filePath);

    return patterns.some((pattern) => pattern.test(normalized));
  };
}

export function filterDiffFiles(files, globs) {
  const isExcluded = createExcludeMatcher(globs);
  const included = [];
  let excludedFilesCount = 0;

  for (const file of files) {
    const currentPath = typeof file.filename === 'string' ? file.filename : '';

    if (currentPath.length === 0) {
      continue;
    }

    if (isExcluded(currentPath)) {
      excludedFilesCount += 1;
      continue;
    }

    included.push({ ...file, filename: normalizePath(currentPath) });
  }

  return {
    included,
    excludedFilesCount,
  };
}

export function decideCompareFallback({ files, excludeGlobs, maxFiles }) {
  if (!Array.isArray(files)) {
    return {
      useFallback: true,
      reason: 'compare-files-invalid',
      included: [],
      excludedFilesCount: 0,
    };
  }

  if (files.length > maxFiles) {
    return {
      useFallback: true,
      reason: 'compare-max-files-exceeded',
      included: [],
      excludedFilesCount: 0,
    };
  }

  const { included, excludedFilesCount } = filterDiffFiles(files, excludeGlobs);

  if (included.length === 0) {
    return {
      useFallback: true,
      reason: 'compare-no-files-after-exclusion',
      included,
      excludedFilesCount,
    };
  }

  const missingPatchFiles = included.filter(
    (file) => typeof file.patch !== 'string' || file.patch.trim().length === 0,
  );

  if (missingPatchFiles.length > 0) {
    return {
      useFallback: true,
      reason: 'compare-missing-patch',
      included,
      excludedFilesCount,
    };
  }

  const validPatchFiles = included.filter(
    (file) => typeof file.patch === 'string' && file.patch.trim().length > 0,
  );

  if (validPatchFiles.length === 0) {
    return {
      useFallback: true,
      reason: 'compare-no-valid-patch',
      included,
      excludedFilesCount,
    };
  }

  return {
    useFallback: false,
    reason: null,
    included,
    excludedFilesCount,
  };
}

export function normalizeDiffEntries(files) {
  return files.map((file) => ({
    filename: file.filename,
    status: file.status ?? 'modified',
    previousFilename:
      typeof file.previous_filename === 'string' ? file.previous_filename : undefined,
    patch:
      typeof file.patch === 'string' && file.patch.trim().length > 0
        ? file.patch
        : '(no textual patch available)',
  }));
}

export function formatDiffEntry(entry) {
  const sourceText =
    typeof entry.previousFilename === 'string' && entry.previousFilename.length > 0
      ? ` (from ${entry.previousFilename})`
      : '';

  const header = `diff --file ${entry.status} ${entry.filename}${sourceText}`;
  const patchText =
    typeof entry.patch === 'string' && entry.patch.length > 0
      ? entry.patch.trimEnd()
      : '(no textual patch available)';

  return `${header}\n${patchText}\n`;
}

function byteLength(text) {
  return Buffer.byteLength(text, 'utf8');
}

function trimTextToUtf8Bytes(text, maxBytes) {
  if (maxBytes <= 0) {
    return '';
  }

  let result = '';
  let usedBytes = 0;

  for (const char of text) {
    const charBytes = byteLength(char);

    if (usedBytes + charBytes > maxBytes) {
      break;
    }

    result += char;
    usedBytes += charBytes;
  }

  return result;
}

function renderTruncationNotice(meta) {
  return [
    '# diff-truncation-meta',
    `totalFiles: ${meta.totalFiles}`,
    `includedFiles: ${meta.includedFiles}`,
    `omittedFiles: ${meta.omittedFiles}`,
    `finalBytes: ${meta.finalBytes}`,
    `truncated: ${String(meta.truncated)}`,
  ].join('\n');
}

function composeDiff(chunks, totalFiles, forceTruncated) {
  const body = chunks.join('\n');
  const truncated = forceTruncated || chunks.length < totalFiles;

  if (!truncated) {
    const finalBytes = byteLength(body);

    return {
      diffText: body,
      meta: {
        totalFiles,
        includedFiles: chunks.length,
        omittedFiles: totalFiles - chunks.length,
        finalBytes,
        truncated,
      },
    };
  }

  const baseMeta = {
    totalFiles,
    includedFiles: chunks.length,
    omittedFiles: totalFiles - chunks.length,
    finalBytes: 0,
    truncated: true,
  };

  let notice = renderTruncationNotice(baseMeta);
  let withNotice = body.length > 0 ? `${body}\n${notice}` : notice;
  const firstBytes = byteLength(withNotice);

  const finalMeta = {
    ...baseMeta,
    finalBytes: firstBytes,
  };

  notice = renderTruncationNotice(finalMeta);
  withNotice = body.length > 0 ? `${body}\n${notice}` : notice;

  return {
    diffText: withNotice,
    meta: {
      ...finalMeta,
      finalBytes: byteLength(withNotice),
    },
  };
}

export function buildLimitedDiff(entries, maxBytes) {
  const safeMaxBytes = Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : 102400;
  const chunks = entries.map((entry) => formatDiffEntry(entry));
  const selected = [];

  for (const chunk of chunks) {
    const candidate = composeDiff([...selected, chunk], chunks.length, false);

    if (candidate.meta.finalBytes > safeMaxBytes) {
      break;
    }

    selected.push(chunk);
  }

  let composed = composeDiff(selected, chunks.length, selected.length < chunks.length);

  while (composed.meta.finalBytes > safeMaxBytes && selected.length > 0) {
    selected.pop();
    composed = composeDiff(selected, chunks.length, true);
  }

  if (composed.meta.finalBytes > safeMaxBytes) {
    const trimmedText = trimTextToUtf8Bytes(composed.diffText, safeMaxBytes);

    return {
      diffText: trimmedText,
      meta: {
        totalFiles: chunks.length,
        includedFiles: 0,
        omittedFiles: chunks.length,
        finalBytes: byteLength(trimmedText),
        truncated: chunks.length > 0,
      },
    };
  }

  return composed;
}

export function maskSensitiveContent(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return '';
  }

  return text
    .replaceAll(/(Authorization\s*[:=]\s*)([^\n\r]+)/gi, '$1[REDACTED]')
    .replaceAll(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replaceAll(
      /(\"?(?:password|secret|token|apiKey)\"?\s*[:=]\s*)\"([^\"\n\r]*)\"/gi,
      '$1"[REDACTED]"',
    )
    .replaceAll(
      /(\"?(?:password|secret|token|apiKey)\"?\s*[:=]\s*)([^\s,\n\r]+)/gi,
      '$1[REDACTED]',
    );
}

function asNonEmptyString(value, keyName) {
  if (typeof value !== 'string') {
    throw new Error(`invalid-${keyName}-type`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`invalid-${keyName}-empty`);
  }

  return trimmed;
}

function validateStringArray(value, keyName) {
  if (!Array.isArray(value)) {
    throw new Error(`invalid-${keyName}-type`);
  }

  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`invalid-${keyName}-${index}-type`);
    }

    const trimmed = item.trim();

    if (trimmed.length === 0) {
      throw new Error(`invalid-${keyName}-${index}-empty`);
    }

    return trimmed;
  });
}

export function validateAiSummaryJson(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('invalid-root-object');
  }

  const rootAllowedKeys = new Set([
    'title',
    'summary',
    'changes',
    'impact',
    'checklist',
    'risks',
    'labels',
  ]);

  for (const key of Object.keys(payload)) {
    if (!rootAllowedKeys.has(key)) {
      throw new Error(`invalid-root-additional-property:${key}`);
    }
  }

  const title = asNonEmptyString(payload.title, 'title');
  const summary = asNonEmptyString(payload.summary, 'summary');

  if (!Array.isArray(payload.changes)) {
    throw new Error('invalid-changes-type');
  }

  const changes = payload.changes.map((change, index) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) {
      throw new Error(`invalid-changes-${index}-type`);
    }

    const changeAllowedKeys = new Set(['area', 'description', 'importance']);

    for (const key of Object.keys(change)) {
      if (!changeAllowedKeys.has(key)) {
        throw new Error(`invalid-changes-${index}-additional-property:${key}`);
      }
    }

    const area = asNonEmptyString(change.area, `changes-${index}-area`);
    const description = asNonEmptyString(
      change.description,
      `changes-${index}-description`,
    );

    if (typeof change.importance !== 'string') {
      throw new Error(`invalid-changes-${index}-importance-type`);
    }

    const importance = change.importance.trim();

    if (!IMPORTANCE_VALUES.has(importance)) {
      throw new Error(`invalid-changes-${index}-importance-value`);
    }

    return {
      area,
      description,
      importance,
    };
  });

  const impact = payload.impact;

  if (!impact || typeof impact !== 'object' || Array.isArray(impact)) {
    throw new Error('invalid-impact-type');
  }

  for (const key of Object.keys(impact)) {
    if (!IMPACT_KEYS.includes(key)) {
      throw new Error(`invalid-impact-additional-property:${key}`);
    }
  }

  const normalizedImpact = {};

  for (const key of IMPACT_KEYS) {
    if (typeof impact[key] !== 'string') {
      throw new Error(`invalid-impact-${key}-type`);
    }

    const value = impact[key].trim();

    if (!IMPACT_VALUES.has(value)) {
      throw new Error(`invalid-impact-${key}-value`);
    }

    normalizedImpact[key] = value;
  }

  const checklist = validateStringArray(payload.checklist, 'checklist');
  const risks = validateStringArray(payload.risks, 'risks');

  const labels = validateStringArray(payload.labels, 'labels');

  return {
    title,
    summary,
    changes,
    impact: normalizedImpact,
    checklist,
    risks,
    labels,
  };
}

function joinList(values, fallbackValue) {
  if (!Array.isArray(values) || values.length === 0) {
    return fallbackValue;
  }

  return values.join(', ');
}

export function renderSummaryBlock(summary, meta) {
  const changeLines =
    summary.changes.length > 0
      ? summary.changes.map(
          (change) =>
            `- [${change.importance}] ${change.area}: ${change.description}`,
        )
      : ['- [low] general: 변경사항 정보가 없습니다.'];

  const checklistLines =
    summary.checklist.length > 0
      ? summary.checklist.map((item) => `- ${item}`)
      : ['- 없음'];

  const riskLines =
    summary.risks.length > 0
      ? summary.risks.map((item) => `- ${item}`)
      : ['- 없음'];

  return [
    MARKER_START,
    '## AI PR 요약',
    '',
    '### 제목 제안',
    summary.title,
    '',
    '### 요약',
    summary.summary,
    '',
    '### 변경사항',
    ...changeLines,
    '',
    '### 영향도',
    `- API: ${summary.impact.api}`,
    `- DB: ${summary.impact.db}`,
    `- Security: ${summary.impact.security}`,
    `- Performance: ${summary.impact.performance}`,
    `- Operations: ${summary.impact.operations}`,
    `- Tests: ${summary.impact.tests}`,
    '',
    '### 체크리스트',
    ...checklistLines,
    '',
    '### 리스크',
    ...riskLines,
    '',
    '### 메타',
    `- Diff Source: ${meta.diffSource}`,
    `- Diff Bytes: ${meta.finalBytes}`,
    `- Excluded Files: ${meta.excludedFilesCount}`,
    `- Truncated: ${String(meta.truncated)}`,
    `- Assignees Added: ${joinList(meta.assigneesAdded, 'none')}`,
    `- Labels Added: ${joinList(meta.labelsAdded, 'none')}`,
    `- Unknown Labels Ignored: ${meta.unknownLabelsIgnoredCount}`,
    MARKER_END,
  ].join('\n');
}

export function upsertSummaryBlock(prBody, block) {
  const existingBody = typeof prBody === 'string' ? prBody : '';
  const escapedStart = MARKER_START.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = MARKER_END.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockPattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'm');

  if (blockPattern.test(existingBody)) {
    return existingBody.replace(blockPattern, block);
  }

  if (existingBody.trim().length === 0) {
    return block;
  }

  return `${existingBody.trimEnd()}\n\n${block}`;
}

export function filterKnownLabels(aiLabels, repoLabelNames) {
  const canonicalLabelMap = new Map();

  for (const labelName of repoLabelNames) {
    if (typeof labelName !== 'string') {
      continue;
    }

    const trimmed = labelName.trim();

    if (trimmed.length === 0) {
      continue;
    }

    canonicalLabelMap.set(trimmed.toLowerCase(), trimmed);
  }

  const applicableLabels = [];
  const seen = new Set();
  let unknownLabelsIgnoredCount = 0;

  for (const rawLabel of aiLabels) {
    if (typeof rawLabel !== 'string') {
      unknownLabelsIgnoredCount += 1;
      continue;
    }

    const trimmed = rawLabel.trim();

    if (trimmed.length === 0) {
      unknownLabelsIgnoredCount += 1;
      continue;
    }

    const canonical = canonicalLabelMap.get(trimmed.toLowerCase());

    if (!canonical) {
      unknownLabelsIgnoredCount += 1;
      continue;
    }

    if (seen.has(canonical.toLowerCase())) {
      continue;
    }

    seen.add(canonical.toLowerCase());
    applicableLabels.push(canonical);
  }

  return {
    applicableLabels,
    unknownLabelsIgnoredCount,
  };
}

export function shouldApplyTitle({ applyTitle, aiTitle, existingTitle, labelNames }) {
  if (!applyTitle) {
    return false;
  }

  const hasTitleLock = labelNames.some(
    (labelName) => typeof labelName === 'string' && labelName.toLowerCase() === 'ai-title-lock',
  );

  if (hasTitleLock) {
    return false;
  }

  const normalizedAiTitle = typeof aiTitle === 'string' ? aiTitle.trim() : '';

  if (normalizedAiTitle.length < 5) {
    return false;
  }

  const normalizedExistingTitle =
    typeof existingTitle === 'string' ? existingTitle.trim() : '';

  return normalizedAiTitle !== normalizedExistingTitle;
}

export function toGitDiffFilePath(rawPath) {
  const normalized = normalizePath(rawPath);

  if (normalized.length === 0) {
    return normalized;
  }

  return path.posix.normalize(normalized);
}
