import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { traceable } from 'langsmith/traceable';
import { wrapOpenAI } from 'langsmith/wrappers';
import { OpenAI } from 'openai';

import {
  AI_RESPONSE_JSON_SCHEMA,
  buildExcludeGlobs,
  buildLimitedDiff,
  decideCompareFallback,
  filterDiffFiles,
  filterKnownLabels,
  maskSensitiveContent,
  normalizeDiffEntries,
  renderSummaryBlock,
  shouldApplyTitle,
  toGitDiffFilePath,
  upsertSummaryBlock,
  validateAiSummaryJson,
} from './pr-ai-description-lib.mjs';

const TARGET_ASSIGNEE = 'chanwoo7';
const DEFAULT_MAX_DIFF_BYTES = 102400;
const DEFAULT_MAX_FILES = 300;
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';

function logInfo(message, payload) {
  if (payload === undefined) {
    console.log(`[pr-ai] ${message}`);
    return;
  }

  console.log(`[pr-ai] ${message}`, payload);
}

function logWarn(message, payload) {
  if (payload === undefined) {
    console.warn(`[pr-ai][warn] ${message}`);
    return;
  }

  console.warn(`[pr-ai][warn] ${message}`, payload);
}

async function writeStepSummary(line) {
  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;

  if (!stepSummaryPath) {
    return;
  }

  await fs.appendFile(stepSummaryPath, `${line}\n`, 'utf8');
}

function parseIntegerEnv(rawValue, defaultValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(String(rawValue), 10);

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return defaultValue;
}

function truncateText(value, maxLength = 2000) {
  if (typeof value !== 'string') {
    return '';
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...(truncated)`;
}

function ensureEnv(name) {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`missing-required-env:${name}`);
  }

  return value;
}

function parseRepository() {
  const repository = ensureEnv('GITHUB_REPOSITORY');
  const [owner, repo] = repository.split('/');

  if (!owner || !repo) {
    throw new Error(`invalid-github-repository:${repository}`);
  }

  return {
    owner,
    repo,
  };
}

function createGitHubRequest({ githubToken }) {
  const apiBaseUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com';

  return async function githubRequest(method, routePath, options = {}) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${apiBaseUrl}${routePath}`, {
        method,
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'caquick-pr-ai-description',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (response.status === 204) {
        return null;
      }

      const rawText = await response.text();
      let data = null;

      if (rawText.length > 0) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = { raw: rawText };
        }
      }

      if (!response.ok) {
        const error = new Error(`github-api-error:${response.status}:${routePath}`);
        error.status = response.status;
        error.response = data;
        throw error;
      }

      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`github-api-timeout:${routePath}`);
        timeoutError.status = 408;
        throw timeoutError;
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

function isPermissionError(error) {
  const status = typeof error?.status === 'number' ? error.status : 0;

  return status === 401 || status === 403;
}

async function readEventPayload() {
  const eventPath = ensureEnv('GITHUB_EVENT_PATH');
  const raw = await fs.readFile(eventPath, 'utf8');

  return JSON.parse(raw);
}

async function fetchRepositoryLabels(githubRequest, owner, repo) {
  const labels = [];
  let page = 1;

  while (true) {
    const response = await githubRequest(
      'GET',
      `/repos/${owner}/${repo}/labels?per_page=100&page=${page}`,
    );

    if (!Array.isArray(response) || response.length === 0) {
      break;
    }

    for (const label of response) {
      if (label && typeof label.name === 'string') {
        labels.push(label.name);
      }
    }

    if (response.length < 100) {
      break;
    }

    page += 1;
  }

  return labels;
}

async function tryCompareDiff({
  githubRequest,
  owner,
  repo,
  baseSha,
  headSha,
  excludeGlobs,
  maxFiles,
}) {
  try {
    const compare = await githubRequest(
      'GET',
      `/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`,
      {
        timeoutMs: 20000,
      },
    );

    const files = Array.isArray(compare?.files) ? compare.files : [];
    const decision = decideCompareFallback({
      files,
      excludeGlobs,
      maxFiles,
    });

    if (decision.useFallback) {
      return {
        useFallback: true,
        reason: decision.reason,
        entries: [],
        excludedFilesCount: decision.excludedFilesCount,
      };
    }

    return {
      useFallback: false,
      reason: null,
      entries: normalizeDiffEntries(decision.included),
      excludedFilesCount: decision.excludedFilesCount,
    };
  } catch (error) {
    return {
      useFallback: true,
      reason: `compare-api-error:${error.message}`,
      entries: [],
      excludedFilesCount: 0,
    };
  }
}

function runGitCommand(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function mapGitStatus(rawStatus) {
  if (rawStatus.startsWith('R')) {
    return 'renamed';
  }

  if (rawStatus.startsWith('A')) {
    return 'added';
  }

  if (rawStatus.startsWith('D')) {
    return 'removed';
  }

  if (rawStatus.startsWith('M')) {
    return 'modified';
  }

  return 'modified';
}

function parseNameStatus(nameStatusText) {
  const rows = nameStatusText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const files = [];

  for (const row of rows) {
    const parts = row.split('\t');

    if (parts.length < 2) {
      continue;
    }

    const rawStatus = parts[0];

    if (rawStatus.startsWith('R') && parts.length >= 3) {
      files.push({
        status: mapGitStatus(rawStatus),
        previous_filename: parts[1],
        filename: parts[2],
      });
      continue;
    }

    files.push({
      status: mapGitStatus(rawStatus),
      filename: parts[1],
    });
  }

  return files;
}

function collectDiffFromGit({
  baseSha,
  headSha,
  excludeGlobs,
  maxFiles,
}) {
  runGitCommand([
    'fetch',
    '--no-tags',
    '--prune',
    '--depth=1',
    'origin',
    baseSha,
    headSha,
  ]);

  const range = `${baseSha}...${headSha}`;
  const nameStatus = runGitCommand([
    'diff',
    '--no-color',
    '--diff-algorithm=histogram',
    '--name-status',
    range,
  ]);

  const parsedFiles = parseNameStatus(nameStatus);

  if (parsedFiles.length > maxFiles) {
    throw new Error('git-diff-max-files-exceeded');
  }

  const { included, excludedFilesCount } = filterDiffFiles(parsedFiles, excludeGlobs);

  if (included.length === 0) {
    throw new Error('git-diff-no-files-after-exclusion');
  }

  const entries = included.map((file) => {
    const patch = runGitCommand([
      'diff',
      '--no-color',
      '--diff-algorithm=histogram',
      range,
      '--',
      toGitDiffFilePath(file.filename),
    ]);

    return {
      ...file,
      patch,
    };
  });

  return {
    entries: normalizeDiffEntries(entries),
    excludedFilesCount,
  };
}

export function buildOpenAiPrompt({
  pr,
  repositoryLabels,
  diffText,
}) {
  const prMeta = {
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? 'unknown',
    baseRef: pr.base?.ref ?? 'unknown',
    headRef: pr.head?.ref ?? 'unknown',
    commits: pr.commits ?? 0,
    changedFiles: pr.changed_files ?? 0,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
  };

  return [
    '다음 Pull Request 정보를 기반으로 한국어 PR 요약 JSON을 생성하세요.',
    '',
    '규칙:',
    '- title은 conventional commits 형식의 prefix를 포함하세요 (feat:, fix:, refactor:, docs:, style:, perf:, test:, build:, ci:, chore:, revert: 중 택1). 예: "feat: 사용자 인증 기능 추가"',
    '- summary는 PR 전체를 요약하는 한국어 텍스트를 작성하세요.',
    '- summaryBullets는 핵심 변경사항을 간결한 한국어 리스트 항목으로 작성하세요. 불필요하면 빈 배열로 두세요.',
    '- changes는 변경된 각 파일별로 { file, description } 형태로 작성하세요. file은 파일 경로 원문, description은 해당 파일의 변경 내용을 한국어 문장으로 작성하세요.',
    '- impact는 이 PR이 시스템에 미치는 영향을 자유 형식 한국어 텍스트 리스트로 작성하세요. 영향이 없으면 빈 배열로 두세요.',
    '- checklist는 리뷰어가 꼭 확인해야 할 항목들을 한국어로 작성하세요. 애매하거나 추상적인 항목은 피하고, 객관적이고 명확한 행동 지침을 간결하게 작성하세요.',
    '- breakingChanges는 하위 호환성을 깨는 변경사항을 작성하세요. 없으면 빈 배열로 두세요.',
    '- relatedIssues는 관련 이슈/PR을 "#번호 설명" 형태로 작성하세요. 없으면 빈 배열로 두세요.',
    '- dependencies는 추가/제거/업데이트된 패키지 의존성을 작성하세요. 없으면 빈 배열로 두세요.',
    '- labels는 아래 제공된 레포 라벨 목록에서만 선택하세요. 최대 3개까지 선택할 수 있으나, 꼭 필요한 경우가 아니면 1-2개로 제한하는 것을 권장합니다.',
    '- 코드 식별자/파일 경로/에러 메시지는 원문을 유지하세요.',
    '',
    `PR Meta:\n${JSON.stringify(prMeta, null, 2)}`,
    '',
    `Repository Labels:\n${JSON.stringify(repositoryLabels, null, 2)}`,
    '',
    `Diff:\n${diffText}`,
  ].join('\n');
}

function extractChatCompletionContent(responseData) {
  const content = responseData?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item?.text === 'string') {
          return item.text;
        }

        return '';
      })
      .join('');
  }

  return '';
}

function serializeOpenAiErrorResponse(error) {
  const detail = error?.error ?? error?.response ?? error?.body;

  if (typeof detail === 'string') {
    return detail;
  }

  if (detail && typeof detail === 'object') {
    try {
      return JSON.stringify(detail);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function buildChatCompletionRequest({
  model,
  messages,
}) {
  const request = {
    model,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'pr_ai_summary',
        strict: true,
        schema: AI_RESPONSE_JSON_SCHEMA,
      },
    },
  };

  // GPT-5 계열은 temperature 파라미터를 허용하지 않는다.
  if (!model.startsWith('gpt-5')) {
    request.temperature = 0.2;
  }

  return request;
}

export async function requestOpenAiSummary({
  openAiClient,
  model,
  messages,
  langsmithExtra,
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const responseData = await openAiClient.chat.completions.create(
      buildChatCompletionRequest({
        model,
        messages,
      }),
      {
        signal: controller.signal,
        langsmithExtra,
      },
    );
    const content = extractChatCompletionContent(responseData);

    if (!content || content.trim().length === 0) {
      throw new Error('openai-empty-response');
    }

    let parsed;

    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('openai-json-parse-failed');
    }

    try {
      return validateAiSummaryJson(parsed);
    } catch (error) {
      const validationError = new Error(`openai-schema-validation-failed:${error.message}`);
      validationError.cause = error;
      throw validationError;
    }
  } catch (error) {
    if (
      error?.name === 'AbortError' ||
      error?.name === 'APIConnectionTimeoutError' ||
      error?.name === 'APIUserAbortError'
    ) {
      throw new Error('openai-timeout');
    }

    if (typeof error?.status === 'number') {
      const apiError = new Error(`openai-api-error:${error.status}`);
      apiError.status = error.status;

      const rawResponse = serializeOpenAiErrorResponse(error);

      if (typeof rawResponse === 'string' && rawResponse.length > 0) {
        apiError.response = rawResponse;
      }

      throw apiError;
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function patchPullRequest({
  githubRequest,
  owner,
  repo,
  number,
  title,
  body,
}) {
  const payload = {
    body,
  };

  if (typeof title === 'string') {
    payload.title = title;
  }

  return githubRequest('PATCH', `/repos/${owner}/${repo}/pulls/${number}`, {
    body: payload,
  });
}

async function addAssignee({
  githubRequest,
  owner,
  repo,
  number,
  currentAssignees,
}) {
  const normalizedAssignees = currentAssignees.map((assignee) => assignee.toLowerCase());

  if (normalizedAssignees.includes(TARGET_ASSIGNEE.toLowerCase())) {
    return [];
  }

  try {
    await githubRequest('POST', `/repos/${owner}/${repo}/issues/${number}/assignees`, {
      body: { assignees: [TARGET_ASSIGNEE] },
    });

    return [TARGET_ASSIGNEE];
  } catch (error) {
    if (isPermissionError(error)) {
      logWarn('assignee update skipped due to permission issue', {
        status: error.status,
      });
      await writeStepSummary(
        '- Assignee update skipped (permission issue on same-repo PR).',
      );

      return [];
    }

    throw error;
  }
}

async function addLabels({
  githubRequest,
  owner,
  repo,
  number,
  labelsToAdd,
}) {
  if (labelsToAdd.length === 0) {
    return [];
  }

  try {
    await githubRequest('POST', `/repos/${owner}/${repo}/issues/${number}/labels`, {
      body: { labels: labelsToAdd },
    });

    return labelsToAdd;
  } catch (error) {
    if (isPermissionError(error)) {
      logWarn('label update skipped due to permission issue', {
        status: error.status,
      });
      await writeStepSummary(
        '- Label update skipped (permission issue on same-repo PR).',
      );

      return [];
    }

    throw error;
  }
}

function uniqueStringList(values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const key = trimmed.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function shortenSha(sha) {
  if (typeof sha !== 'string') {
    return 'unknown';
  }

  return sha.slice(0, 12);
}

async function run() {
  const githubToken = ensureEnv('GITHUB_TOKEN');
  const openAiApiKey = ensureEnv('OPENAI_API_KEY');
  const openAiModel = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const maxDiffBytes = parseIntegerEnv(
    process.env.PR_AI_MAX_DIFF_BYTES,
    DEFAULT_MAX_DIFF_BYTES,
  );
  const maxFiles = parseIntegerEnv(process.env.PR_AI_MAX_FILES, DEFAULT_MAX_FILES);
  const applyTitle = true;
  const excludeGlobs = buildExcludeGlobs();
  const openAiClient = wrapOpenAI(new OpenAI({ apiKey: openAiApiKey }));

  const runWorkflow = traceable(
    async () => {
      const payload = await readEventPayload();
      const pullRequest = payload.pull_request;

      if (!pullRequest) {
        throw new Error('pull_request payload not found');
      }

      const isFork = pullRequest.head?.repo?.full_name !== payload.repository?.full_name;

      if (isFork) {
        logInfo('fork PR detected. skip by policy.');
        await writeStepSummary('- Fork PR detected: skipped by policy.');
        return {
          status: 'skipped',
          reason: 'fork-pr',
        };
      }

      const { owner, repo } = parseRepository();
      const githubRequest = createGitHubRequest({ githubToken });
      const prNumber = pullRequest.number;
      const baseSha = pullRequest.base?.sha;
      const headSha = pullRequest.head?.sha;

      if (typeof baseSha !== 'string' || typeof headSha !== 'string') {
        throw new Error('base/head sha missing from payload');
      }

      let repositoryLabels = [];

      try {
        repositoryLabels = await fetchRepositoryLabels(githubRequest, owner, repo);
      } catch (error) {
        if (isPermissionError(error)) {
          logWarn('failed to read repository labels due to permission issue', {
            status: error.status,
          });
          await writeStepSummary(
            '- Repository labels could not be loaded (permission issue).',
          );
          repositoryLabels = [];
        } else {
          throw error;
        }
      }

      const collectDiff = traceable(
        async () => {
          const compareResult = await tryCompareDiff({
            githubRequest,
            owner,
            repo,
            baseSha,
            headSha,
            excludeGlobs,
            maxFiles,
          });

          let diffSource = 'compare';
          let diffEntries = compareResult.entries;
          let excludedFilesCount = compareResult.excludedFilesCount;
          let fallbackReason = null;

          if (compareResult.useFallback) {
            logWarn('compare diff unavailable. fallback to git diff.', {
              reason: compareResult.reason,
            });

            const gitResult = collectDiffFromGit({
              baseSha,
              headSha,
              excludeGlobs,
              maxFiles,
            });

            diffSource = 'git';
            diffEntries = gitResult.entries;
            excludedFilesCount = gitResult.excludedFilesCount;
            fallbackReason = compareResult.reason;
          }

          return {
            diffSource,
            diffEntries,
            excludedFilesCount,
            fallbackReason,
          };
        },
        {
          name: 'collect-diff',
          run_type: 'chain',
          metadata: {
            baseSha: shortenSha(baseSha),
            headSha: shortenSha(headSha),
            maxFiles,
            excludeGlobsCount: excludeGlobs.length,
          },
          processOutputs: (value) => ({
            diffSource: value.diffSource,
            diffEntriesCount: value.diffEntries.length,
            excludedFilesCount: value.excludedFilesCount,
            fallbackReason: value.fallbackReason ?? 'none',
          }),
        },
      );

      const diffContext = await collectDiff();

      const { diffSource, diffEntries, excludedFilesCount } = diffContext;

      if (diffEntries.length === 0) {
        throw new Error('no-diff-entries-for-ai');
      }

      const maskedEntries = diffEntries.map((entry) => ({
        ...entry,
        patch: maskSensitiveContent(entry.patch),
      }));

      const limitedDiff = buildLimitedDiff(maskedEntries, maxDiffBytes);
      const maskedDiff = limitedDiff.diffText;

      if (maskedDiff.trim().length === 0) {
        throw new Error('masked-diff-is-empty');
      }

      const prompt = buildOpenAiPrompt({
        pr: pullRequest,
        repositoryLabels,
        diffText: maskedDiff,
      });

      const openAiMessages = [
        {
          role: 'system',
          content:
            'You are a senior backend engineer. Return only JSON that matches the schema.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ];

      const generateAiSummary = traceable(
        async () =>
          requestOpenAiSummary({
            openAiClient,
            model: openAiModel,
            messages: openAiMessages,
            langsmithExtra: {
              metadata: {
                diffSource,
                diffBytes: limitedDiff.meta.finalBytes,
                truncated: limitedDiff.meta.truncated,
                prNumber,
              },
            },
          }),
        {
          name: 'generate-ai-summary',
          run_type: 'chain',
          metadata: {
            diffSource,
            diffBytes: limitedDiff.meta.finalBytes,
            truncated: limitedDiff.meta.truncated,
            prNumber,
          },
          processOutputs: (summary) => ({
            title: summary.title,
            changesCount: summary.changes.length,
            labels: summary.labels,
          }),
        },
      );

      const aiSummary = await generateAiSummary();

      const currentAssignees = uniqueStringList(
        Array.isArray(pullRequest.assignees)
          ? pullRequest.assignees.map((assignee) => assignee?.login)
          : [],
      );

      const currentLabels = uniqueStringList(
        Array.isArray(pullRequest.labels)
          ? pullRequest.labels.map((label) => label?.name)
          : [],
      );

      const applyPrUpdates = traceable(
        async () => {
          const assigneesAdded = await addAssignee({
            githubRequest,
            owner,
            repo,
            number: prNumber,
            currentAssignees,
          });

          const aiLabelCandidates = uniqueStringList(aiSummary.labels);
          const { applicableLabels, unknownLabelsIgnoredCount } = filterKnownLabels(
            aiLabelCandidates,
            repositoryLabels,
          );

          const labelsToAdd = applicableLabels.filter(
            (labelName) =>
              !currentLabels.some((current) => current.toLowerCase() === labelName.toLowerCase()),
          );

          const labelsAdded = await addLabels({
            githubRequest,
            owner,
            repo,
            number: prNumber,
            labelsToAdd,
          });

          const block = renderSummaryBlock(aiSummary);

          const updatedBody = upsertSummaryBlock(pullRequest.body ?? '', block);

          const titleShouldChange = shouldApplyTitle({
            applyTitle,
            aiTitle: aiSummary.title,
            existingTitle: pullRequest.title,
            labelNames: currentLabels,
          });

          const nextTitle = titleShouldChange ? aiSummary.title : undefined;
          const bodyUpdated = updatedBody !== (pullRequest.body ?? '');

          if (bodyUpdated || typeof nextTitle === 'string') {
            await patchPullRequest({
              githubRequest,
              owner,
              repo,
              number: prNumber,
              title: nextTitle,
              body: updatedBody,
            });
          }

          return {
            assigneesAdded,
            labelsAdded,
            unknownLabelsIgnoredCount,
            titleUpdated: typeof nextTitle === 'string',
            bodyUpdated,
          };
        },
        {
          name: 'apply-pr-updates',
          run_type: 'tool',
          metadata: {
            prNumber,
            applyTitle,
          },
          processOutputs: (value) => ({
            assigneesAddedCount: value.assigneesAdded.length,
            labelsAddedCount: value.labelsAdded.length,
            unknownLabelsIgnoredCount: value.unknownLabelsIgnoredCount,
            titleUpdated: value.titleUpdated,
            bodyUpdated: value.bodyUpdated,
          }),
        },
      );

      const updateResult = await applyPrUpdates();

      const { labelsAdded, unknownLabelsIgnoredCount } = updateResult;

      logInfo('PR AI description update completed', {
        diffSource,
        finalBytes: limitedDiff.meta.finalBytes,
        excludedFilesCount,
        truncated: limitedDiff.meta.truncated,
        labelsAppliedCount: labelsAdded.length,
        unknownLabelsIgnoredCount,
      });

      await writeStepSummary('## PR AI Summary Result');
      await writeStepSummary(`- Labels Added: ${labelsAdded.join(', ') || 'none'}`);
      await writeStepSummary(`- Unknown Labels Ignored: ${unknownLabelsIgnoredCount}`);

      return {
        status: 'success',
        prNumber,
        diffSource,
        diffBytes: limitedDiff.meta.finalBytes,
        truncated: limitedDiff.meta.truncated,
        labelsAddedCount: labelsAdded.length,
        unknownLabelsIgnoredCount,
      };
    },
    {
      name: 'pr-ai-description',
      run_type: 'chain',
      metadata: {
        repository: process.env.GITHUB_REPOSITORY ?? 'unknown',
        eventName: process.env.GITHUB_EVENT_NAME ?? 'unknown',
        actor: process.env.GITHUB_ACTOR ?? 'unknown',
        model: openAiModel,
        maxDiffBytes,
        maxFiles,
        applyTitle,
      },
    },
  );

  return runWorkflow();
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) run().catch(async (error) => {
  const rawResponse =
    typeof error?.response === 'string' && error.response.length > 0
      ? error.response
      : null;
  const safeResponse = rawResponse
    ? truncateText(maskSensitiveContent(rawResponse), 4000)
    : null;

  logWarn('PR AI description workflow failed', {
    message: error?.message ?? 'unknown-error',
    status: error?.status,
    openAiErrorResponse: safeResponse ?? undefined,
  });

  await writeStepSummary('## PR AI Summary Failed');
  await writeStepSummary(`- Error: ${error?.message ?? 'unknown-error'}`);
  await writeStepSummary(`- Status: ${error?.status ?? 'unknown'}`);

  if (safeResponse) {
    await writeStepSummary('- OpenAI Error Response:');
    await writeStepSummary('```json');
    await writeStepSummary(safeResponse);
    await writeStepSummary('```');
  }

  process.exit(1);
});
