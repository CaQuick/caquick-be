import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPrUpdatePayload,
  loadCurrentPullRequest,
  requestOpenAiSummary,
} from '../pr-ai-description.mjs';

function createFakeOpenAiClient(createImpl) {
  return {
    chat: {
      completions: {
        create: createImpl,
      },
    },
  };
}

function createValidSummary() {
  return {
    title: 'feat: 사용자 조회 API 개선',
    summary: '응답 필드와 예외 처리를 정리했습니다.',
    summaryBullets: ['조회 조건 검증 로직 추가', '에러 응답 포맷 통일'],
    changes: [
      {
        file: 'src/user/user.service.ts',
        description: '조회 조건 검증 로직 추가',
      },
    ],
    impact: ['API 응답 형식 변경으로 클라이언트 확인 필요'],
    checklist: ['resolver 통합 테스트 확인'],
    breakingChanges: [],
    relatedIssues: [],
    dependencies: [],
    labels: ['backend', 'api'],
  };
}

test('OpenAI SDK 응답을 검증된 summary 객체로 변환한다', async () => {
  let capturedArgs = null;
  const openAiClient = createFakeOpenAiClient(async (...args) => {
    capturedArgs = args;

    return {
      choices: [
        {
          message: {
            content: JSON.stringify(createValidSummary()),
          },
        },
      ],
    };
  });

  const summary = await requestOpenAiSummary({
    openAiClient,
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: 'test' }],
    langsmithExtra: {
      metadata: {
        diffSource: 'compare',
      },
    },
  });

  assert.equal(summary.title, 'feat: 사용자 조회 API 개선');
  assert.equal(capturedArgs[0].response_format.type, 'json_schema');
  assert.equal(capturedArgs[0].temperature, 0.2);
  assert.equal(capturedArgs[1].langsmithExtra.metadata.diffSource, 'compare');
});

test('gpt-5 계열 모델에는 temperature를 포함하지 않는다', async () => {
  let capturedArgs = null;
  const openAiClient = createFakeOpenAiClient(async (...args) => {
    capturedArgs = args;

    return {
      choices: [
        {
          message: {
            content: JSON.stringify(createValidSummary()),
          },
        },
      ],
    };
  });

  await requestOpenAiSummary({
    openAiClient,
    model: 'gpt-5-mini',
    messages: [{ role: 'user', content: 'test' }],
  });

  assert.equal('temperature' in capturedArgs[0], false);
});

test('content가 비어 있으면 openai-empty-response 에러를 던진다', async () => {
  const openAiClient = createFakeOpenAiClient(async () => ({
    choices: [
      {
        message: {
          content: '   ',
        },
      },
    ],
  }));

  await assert.rejects(
    () =>
      requestOpenAiSummary({
        openAiClient,
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: 'test' }],
      }),
    /openai-empty-response/,
  );
});

test('JSON 파싱에 실패하면 openai-json-parse-failed 에러를 던진다', async () => {
  const openAiClient = createFakeOpenAiClient(async () => ({
    choices: [
      {
        message: {
          content: '{not-json}',
        },
      },
    ],
  }));

  await assert.rejects(
    () =>
      requestOpenAiSummary({
        openAiClient,
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: 'test' }],
      }),
    /openai-json-parse-failed/,
  );
});

test('스키마 검증에 실패하면 openai-schema-validation-failed 에러를 던진다', async () => {
  const invalidPayload = {
    ...createValidSummary(),
    labels: undefined,
  };
  const openAiClient = createFakeOpenAiClient(async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify(invalidPayload),
        },
      },
    ],
  }));

  await assert.rejects(
    () =>
      requestOpenAiSummary({
        openAiClient,
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: 'test' }],
      }),
    /openai-schema-validation-failed/,
  );
});

test('OpenAI SDK status 에러를 openai-api-error로 변환한다', async () => {
  const openAiClient = createFakeOpenAiClient(async () => {
    const error = new Error('rate-limited');
    error.status = 429;
    error.error = {
      message: 'too many requests',
    };
    throw error;
  });

  let thrown = null;

  try {
    await requestOpenAiSummary({
      openAiClient,
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: 'test' }],
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof Error);
  assert.equal(thrown.message, 'openai-api-error:429');
  assert.equal(thrown.status, 429);
  assert.match(thrown.response, /too many requests/);
});

test('abort 계열 에러를 openai-timeout 으로 변환한다', async () => {
  const openAiClient = createFakeOpenAiClient(async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  });

  await assert.rejects(
    () =>
      requestOpenAiSummary({
        openAiClient,
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: 'test' }],
    }),
    /openai-timeout/,
  );
});

test('최신 PR body를 기준으로 PR AI 블록을 갱신해 CodeRabbit summary를 보존한다', () => {
  const block = [
    '<!-- pr-ai-summary:start -->',
    'new summary',
    '<!-- pr-ai-summary:end -->',
  ].join('\n');
  const fallbackPullRequest = {
    title: '기존 제목',
    body: 'stale body',
    labels: [],
  };
  const currentPullRequest = {
    title: '기존 제목',
    body: [
      '기존 본문',
      '',
      '## Summary by CodeRabbit',
      'CodeRabbit summary',
    ].join('\n'),
    labels: [],
  };

  const result = buildPrUpdatePayload({
    currentPullRequest,
    fallbackPullRequest,
    block,
    applyTitle: true,
    aiTitle: 'feat: 새 제목',
  });

  assert.match(result.updatedBody, /기존 본문/);
  assert.match(result.updatedBody, /## Summary by CodeRabbit/);
  assert.ok(
    result.updatedBody.indexOf('<!-- pr-ai-summary:end -->') <
      result.updatedBody.indexOf('## Summary by CodeRabbit'),
  );
  assert.equal(result.currentBody, currentPullRequest.body);
});

test('최신 PR 재조회가 실패하면 이벤트 payload를 fallback으로 사용한다', async () => {
  const fallbackPullRequest = {
    title: 'payload title',
    body: 'payload body',
  };

  const pullRequest = await loadCurrentPullRequest({
    githubRequest: async () => {
      const error = new Error('boom');
      error.status = 500;
      throw error;
    },
    owner: 'caquick',
    repo: 'caquick-be',
    number: 10,
    fallbackPullRequest,
    onWarn: () => {},
  });

  assert.deepEqual(pullRequest, fallbackPullRequest);
});
