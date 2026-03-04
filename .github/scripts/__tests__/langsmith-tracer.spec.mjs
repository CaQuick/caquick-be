import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLangSmithTracer,
  resolveLangSmithTraceConfig,
} from '../langsmith-tracer.mjs';

function createFetchRecorder() {
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    let body = null;

    if (typeof options.body === 'string' && options.body.length > 0) {
      body = JSON.parse(options.body);
    }

    calls.push({
      url,
      options,
      body,
    });

    return {
      ok: true,
      status: 200,
      async text() {
        return '';
      },
      async json() {
        return {};
      },
    };
  };

  return {
    calls,
    fetchImpl,
  };
}

test('LANGSMITH_TRACING=false 이면 tracing 설정이 비활성화된다', () => {
  const config = resolveLangSmithTraceConfig({
    LANGSMITH_TRACING: 'false',
    LANGSMITH_API_KEY: 'lsv2_xxx',
  });

  assert.equal(config.enabled, false);
  assert.equal(config.reason, 'langsmith-tracing-disabled');
});

test('API KEY가 없으면 tracing 설정이 비활성화된다', () => {
  const config = resolveLangSmithTraceConfig({
    LANGSMITH_TRACING: 'true',
  });

  assert.equal(config.enabled, false);
  assert.equal(config.reason, 'langsmith-api-key-missing');
});

test('설정값이 없으면 endpoint/project 기본값을 사용한다', () => {
  const config = resolveLangSmithTraceConfig({
    LANGSMITH_API_KEY: 'lsv2_xxx',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.endpoint, 'https://api.smith.langchain.com');
  assert.equal(config.projectName, 'caquick-pr-ai-description');
  assert.equal(config.workspaceId, null);
});

test('withRun 성공 시 /runs POST 후 PATCH가 호출된다', async () => {
  const { calls, fetchImpl } = createFetchRecorder();
  const tracer = createLangSmithTracer({
    env: {
      LANGSMITH_API_KEY: 'lsv2_xxx',
      LANGSMITH_PROJECT: 'caquick-ci',
    },
    fetchImpl,
  });

  const result = await tracer.withRun(
    {
      name: 'openai-summary',
      runType: 'llm',
      inputs: { model: 'gpt-4.1-mini' },
      mapOutput: (value) => ({
        title: value.title,
      }),
    },
    async () => ({
      title: '요약 제목',
      longText: '생략',
    }),
  );

  assert.equal(result.title, '요약 제목');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.smith.langchain.com/runs');
  assert.equal(calls[0].body.session_name, 'caquick-ci');
  assert.equal(calls[0].body.run_type, 'llm');

  const runId = calls[0].body.id;
  assert.ok(typeof runId === 'string' && runId.length > 0);
  assert.equal(calls[1].url, `https://api.smith.langchain.com/runs/${runId}`);
  assert.equal(calls[1].body.outputs.title, '요약 제목');
});

test('withRun 실패 시 에러를 PATCH로 기록하고 예외를 다시 던진다', async () => {
  const { calls, fetchImpl } = createFetchRecorder();
  const tracer = createLangSmithTracer({
    env: {
      LANGSMITH_API_KEY: 'lsv2_xxx',
    },
    fetchImpl,
  });

  await assert.rejects(
    () =>
      tracer.withRun(
        {
          name: 'fail-step',
          runType: 'tool',
          inputs: { stage: 'patch-pr' },
        },
        async () => {
          throw new Error('intentional-failure');
        },
      ),
    /intentional-failure/,
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.outputs.constructor, Object);
  assert.match(calls[1].body.error, /intentional-failure/);
});

test('workspace id가 있으면 x-tenant-id 헤더가 포함된다', async () => {
  const { calls, fetchImpl } = createFetchRecorder();
  const tracer = createLangSmithTracer({
    env: {
      LANGSMITH_API_KEY: 'lsv2_xxx',
      LANGSMITH_WORKSPACE_ID: 'workspace-123',
    },
    fetchImpl,
  });

  await tracer.startRun({
    name: 'root-run',
    runType: 'chain',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['x-tenant-id'], 'workspace-123');
});
