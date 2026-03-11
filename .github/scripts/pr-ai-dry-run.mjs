/**
 * PR AI Dry-Run 스크립트
 *
 * 기존 PR AI 파이프라인과 동일한 흐름으로 OpenAI 요약을 생성하되,
 * 실제 PR 업데이트 없이 결과만 콘솔에 출력한다.
 *
 * 사용법:
 *   # 기존 PR 기반 (GitHub API로 diff 수집)
 *   OPENAI_API_KEY=sk-xxx node .github/scripts/pr-ai-dry-run.mjs --pr 42
 *
 *   # 현재 브랜치 기반 (로컬 git diff)
 *   OPENAI_API_KEY=sk-xxx node .github/scripts/pr-ai-dry-run.mjs
 */

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import process from 'node:process';

import { traceable } from 'langsmith/traceable';
import { wrapOpenAI } from 'langsmith/wrappers';
import { OpenAI } from 'openai';

import {
  buildExcludeGlobs,
  buildLimitedDiff,
  filterDiffFiles,
  filterKnownLabels,
  maskSensitiveContent,
  normalizeDiffEntries,
  renderSummaryBlock,
  toGitDiffFilePath,
} from './pr-ai-description-lib.mjs';

import {
  buildOpenAiPrompt,
  requestOpenAiSummary,
} from './pr-ai-description.mjs';

const DEFAULT_MAX_DIFF_BYTES = 102400;
const DEFAULT_MAX_FILES = 300;
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const DEFAULT_BASE_BRANCH = 'main';

function log(message) {
  console.log(`[dry-run] ${message}`);
}

function logWarn(message) {
  console.warn(`[dry-run][warn] ${message}`);
}

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function mapGitStatus(rawStatus) {
  if (rawStatus.startsWith('R')) return 'renamed';
  if (rawStatus.startsWith('A')) return 'added';
  if (rawStatus.startsWith('D')) return 'removed';
  return 'modified';
}

function parseNameStatus(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((row) => {
      const parts = row.split('\t');
      if (parts.length < 2) return null;

      const rawStatus = parts[0];
      if (rawStatus.startsWith('R') && parts.length >= 3) {
        return {
          status: mapGitStatus(rawStatus),
          previous_filename: parts[1],
          filename: parts[2],
        };
      }

      return {
        status: mapGitStatus(rawStatus),
        filename: parts[1],
      };
    })
    .filter(Boolean);
}

// -- PR 모드: GitHub API로 PR 정보 + diff 수집 --

function fetchPrData(prNumber) {
  const raw = runGh([
    'api',
    `repos/{owner}/{repo}/pulls/${prNumber}`,
    '--jq',
    '.',
  ]);

  return JSON.parse(raw);
}

function fetchCompareDiff(baseSha, headSha) {
  const raw = runGh([
    'api',
    `repos/{owner}/{repo}/compare/${baseSha}...${headSha}`,
    '--jq',
    '.files',
  ]);

  return JSON.parse(raw);
}

function fetchRepositoryLabels() {
  try {
    const raw = runGh([
      'api',
      'repos/{owner}/{repo}/labels',
      '--paginate',
      '--jq',
      '.[].name',
    ]);

    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    logWarn('레포 라벨 조회 실패. 빈 목록으로 진행합니다.');
    return [];
  }
}

async function runWithPr(prNumber, options) {
  log(`PR #${prNumber} 정보 조회 중...`);
  const pr = fetchPrData(prNumber);
  const baseSha = pr.base?.sha;
  const headSha = pr.head?.sha;

  if (!baseSha || !headSha) {
    throw new Error('PR에서 base/head SHA를 가져올 수 없습니다.');
  }

  log(`diff 수집 중... (${baseSha.slice(0, 8)}...${headSha.slice(0, 8)})`);
  const compareFiles = fetchCompareDiff(baseSha, headSha);

  const excludeGlobs = buildExcludeGlobs();
  const { included } = filterDiffFiles(compareFiles, excludeGlobs);

  if (included.length === 0) {
    throw new Error('필터링 후 diff 파일이 없습니다.');
  }

  const diffEntries = normalizeDiffEntries(included);
  const repositoryLabels = fetchRepositoryLabels();

  return generateAndPrint({
    pr,
    diffEntries,
    diffSource: 'compare',

    repositoryLabels,
    ...options,
  });
}

// -- 브랜치 모드: 로컬 git diff 수집 --

async function runWithBranch(options) {
  const baseBranch = options.baseBranch;
  const currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);

  log(`현재 브랜치: ${currentBranch}, 비교 대상: ${baseBranch}`);

  const mergeBase = runGit(['merge-base', baseBranch, 'HEAD']);
  const range = `${mergeBase}...HEAD`;

  log(`diff 수집 중... (${mergeBase.slice(0, 8)}...HEAD)`);

  const nameStatus = runGit([
    'diff',
    '--no-color',
    '--diff-algorithm=histogram',
    '--name-status',
    range,
  ]);

  if (!nameStatus) {
    throw new Error(`${baseBranch} 대비 변경사항이 없습니다.`);
  }

  const parsedFiles = parseNameStatus(nameStatus);

  if (parsedFiles.length > options.maxFiles) {
    throw new Error(`파일 수 초과: ${parsedFiles.length} > ${options.maxFiles}`);
  }

  const excludeGlobs = buildExcludeGlobs();
  const { included } = filterDiffFiles(parsedFiles, excludeGlobs);

  if (included.length === 0) {
    throw new Error('필터링 후 diff 파일이 없습니다.');
  }

  const entries = included.map((file) => {
    const patch = runGit([
      'diff',
      '--no-color',
      '--diff-algorithm=histogram',
      range,
      '--',
      toGitDiffFilePath(file.filename),
    ]);
    return { ...file, patch };
  });

  const diffEntries = normalizeDiffEntries(entries);

  // 브랜치 모드에서는 PR 메타를 git 정보로 구성
  const pr = {
    number: 0,
    title: currentBranch,
    user: { login: runGit(['config', 'user.name']) || 'local' },
    base: { ref: baseBranch },
    head: { ref: currentBranch },
    commits: parseInt(runGit(['rev-list', '--count', range]), 10) || 0,
    changed_files: diffEntries.length,
    additions: 0,
    deletions: 0,
  };

  let repositoryLabels = [];

  try {
    repositoryLabels = fetchRepositoryLabels();
  } catch {
    // gh CLI 없거나 인증 안 된 경우 빈 목록으로 진행
  }

  return generateAndPrint({
    pr,
    diffEntries,
    diffSource: 'git',

    repositoryLabels,
    ...options,
  });
}

// -- 공통: OpenAI 호출 + 결과 출력 --

async function generateAndPrint({
  pr,
  diffEntries,
  diffSource,
  repositoryLabels,
  openAiClient,
  openAiModel,
  maxDiffBytes,
}) {
  const runDryRun = traceable(
    async () => {
      const maskedEntries = diffEntries.map((entry) => ({
        ...entry,
        patch: maskSensitiveContent(entry.patch),
      }));

      const limitedDiff = buildLimitedDiff(maskedEntries, maxDiffBytes);

      if (limitedDiff.diffText.trim().length === 0) {
        throw new Error('마스킹 후 diff가 비어있습니다.');
      }

      log(
        `diff 준비 완료 (${limitedDiff.meta.finalBytes} bytes, ${diffEntries.length}개 파일, truncated: ${limitedDiff.meta.truncated})`,
      );

      const prompt = buildOpenAiPrompt({
        pr,
        repositoryLabels,
        diffText: limitedDiff.diffText,
      });

      const openAiMessages = [
        {
          role: 'system',
          content: 'You are a senior backend engineer. Return only JSON that matches the schema.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ];

      log(`OpenAI 호출 중... (model: ${openAiModel})`);

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
                prNumber: pr.number,
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
            prNumber: pr.number,
          },
          processOutputs: (summary) => ({
            title: summary.title,
            changesCount: summary.changes.length,
            labels: summary.labels,
          }),
        },
      );

      const aiSummary = await generateAiSummary();

      log('AI 요약 생성 완료\n');

      const { applicableLabels, unknownLabelsIgnoredCount } = filterKnownLabels(
        aiSummary.labels,
        repositoryLabels,
      );
      const block = renderSummaryBlock(aiSummary);

      console.log('='.repeat(60));
      console.log('  AI 제목 제안');
      console.log('='.repeat(60));
      console.log(aiSummary.title);
      console.log();
      console.log('='.repeat(60));
      console.log('  적용될 라벨');
      console.log('='.repeat(60));
      console.log(applicableLabels.length > 0 ? applicableLabels.join(', ') : '(없음)');
      if (unknownLabelsIgnoredCount > 0) {
        console.log(`  (레포에 없는 라벨 ${unknownLabelsIgnoredCount}개 무시됨)`);
      }
      console.log();
      console.log('='.repeat(60));
      console.log('  PR 본문에 삽입될 AI 요약 블록');
      console.log('='.repeat(60));
      console.log(block);

      return {
        status: 'success',
        diffSource,
        diffBytes: limitedDiff.meta.finalBytes,
        truncated: limitedDiff.meta.truncated,
        labelsCount: applicableLabels.length,
        unknownLabelsIgnoredCount,
      };
    },
    {
      name: 'pr-ai-dry-run',
      run_type: 'chain',
      metadata: {
        mode: pr.number > 0 ? 'pr' : 'branch',
        prNumber: pr.number,
        model: openAiModel,
        maxDiffBytes,
        diffSource,
      },
    },
  );

  return runDryRun();
}

// -- 진입점 --

async function main() {
  const { values } = parseArgs({
    options: {
      pr: { type: 'string' },
      model: { type: 'string' },
      base: { type: 'string' },
      'max-diff-bytes': { type: 'string' },
      'max-files': { type: 'string' },
    },
    strict: false,
  });

  const openAiApiKey = process.env.OPENAI_API_KEY;

  if (!openAiApiKey) {
    console.error('[dry-run] OPENAI_API_KEY 환경변수가 필요합니다.');
    process.exit(1);
  }

  const openAiClient = wrapOpenAI(new OpenAI({ apiKey: openAiApiKey }));

  const options = {
    openAiClient,
    openAiModel: values.model || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    maxDiffBytes: parseInt(values['max-diff-bytes'] ?? '', 10) || DEFAULT_MAX_DIFF_BYTES,
    maxFiles: parseInt(values['max-files'] ?? '', 10) || DEFAULT_MAX_FILES,
    baseBranch: values.base || DEFAULT_BASE_BRANCH,
  };

  if (values.pr) {
    const prNumber = parseInt(values.pr, 10);

    if (Number.isNaN(prNumber) || prNumber <= 0) {
      console.error(`[dry-run] 잘못된 PR 번호: ${values.pr}`);
      process.exit(1);
    }

    await runWithPr(prNumber, options);
  } else {
    await runWithBranch(options);
  }
}

main().catch((error) => {
  console.error(`[dry-run] 실패: ${error.message}`);
  process.exit(1);
});
