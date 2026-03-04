import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLangSmithTracer,
  resolveLangSmithTraceConfig,
} from '../langsmith-tracer.mjs';

function createClientRecorder(options = {}) {
  const createCalls = [];
  const updateCalls = [];
  const createErrorMessage = options.createErrorMessage;
  const updateErrorMessage = options.updateErrorMessage;

  const client = {
    async createRun(payload) {
      createCalls.push(payload);

      if (typeof createErrorMessage === 'string') {
        throw new Error(createErrorMessage);
      }
    },
    async updateRun(runId, payload) {
      updateCalls.push({
        runId,
        payload,
      });

      if (typeof updateErrorMessage === 'string') {
        throw new Error(updateErrorMessage);
      }
    },
  };

  return {
    client,
    createCalls,
    updateCalls,
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

test('withRun 성공 시 SDK createRun/updateRun이 호출된다', async () => {
  const { client, createCalls, updateCalls } = createClientRecorder();
  const tracer = createLangSmithTracer({
    env: {
      LANGSMITH_API_KEY: 'lsv2_xxx',
      LANGSMITH_PROJECT: 'caquick-ci',
    },
    client,
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
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].project_name, 'caquick-ci');
  assert.equal(createCalls[0].run_type, 'llm');

  const runId = createCalls[0].id;
  assert.ok(typeof runId === 'string' && runId.length > 0);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].runId, runId);
  assert.equal(updateCalls[0].payload.outputs.title, '요약 제목');
});

test('withRun 실패 시 에러를 PATCH로 기록하고 예외를 다시 던진다', async () => {
  const { client, createCalls, updateCalls } = createClientRecorder();
  const tracer = createLangSmithTracer({
    env: {
      LANGSMITH_API_KEY: 'lsv2_xxx',
    },
    client,
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

  assert.equal(createCalls.length, 1);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].payload.outputs.constructor, Object);
  assert.match(updateCalls[0].payload.error, /intentional-failure/);
});

test('workspace id는 SDK Client 초기화 옵션으로 전달된다', () => {
  let capturedClientConfig = null;

  createLangSmithTracer({
    env: {
      LANGSMITH_API_KEY: 'lsv2_xxx',
      LANGSMITH_WORKSPACE_ID: 'workspace-123',
      LANGSMITH_ENDPOINT: 'https://api.eu.smith.langchain.com',
    },
    clientFactory: (clientConfig) => {
      capturedClientConfig = clientConfig;
      return {
        async createRun() {},
        async updateRun() {},
      };
    },
  });

  assert.ok(capturedClientConfig);
  assert.equal(capturedClientConfig.workspaceId, 'workspace-123');
  assert.equal(capturedClientConfig.apiUrl, 'https://api.eu.smith.langchain.com');
  assert.equal(capturedClientConfig.autoBatchTracing, false);
});

test('SDK 호출 실패는 경고 로그만 남기고 작업을 중단하지 않는다', async () => {
  const { client, createCalls, updateCalls } = createClientRecorder({
    createErrorMessage: 'create-failed',
    updateErrorMessage: 'update-failed',
  });
  const logs = [];
  const tracer = createLangSmithTracer({
    env: {
      LANGSMITH_API_KEY: 'lsv2_xxx',
    },
    client,
    logger: (level, message, payload) => {
      logs.push({ level, message, payload });
    },
  });

  const result = await tracer.withRun(
    {
      name: 'resilient-run',
      runType: 'chain',
    },
    async () => ({
      ok: true,
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(createCalls.length, 1);
  assert.equal(updateCalls.length, 1);
  assert.ok(logs.some((entry) => entry.level === 'warn'));
});
