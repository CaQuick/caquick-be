import { randomUUID } from 'node:crypto';
import process from 'node:process';

const DEFAULT_LANGSMITH_ENDPOINT = 'https://api.smith.langchain.com';
const DEFAULT_LANGSMITH_PROJECT = 'caquick-pr-ai-description';
const REQUEST_TIMEOUT_MS = 10000;

function parseBoolean(rawValue, defaultValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function toOptionalString(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }

  const trimmed = rawValue.trim();

  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

function nowIsoString() {
  return new Date().toISOString();
}

function toTraceError(error) {
  if (!error) {
    return 'unknown-error';
  }

  const message =
    typeof error.message === 'string' && error.message.trim().length > 0
      ? error.message.trim()
      : 'unknown-error';

  if (typeof error.stack === 'string' && error.stack.trim().length > 0) {
    return `${message}\n${error.stack.slice(0, 2000)}`;
  }

  return message;
}

export function resolveLangSmithTraceConfig(env = process.env) {
  const tracingEnabled = parseBoolean(env.LANGSMITH_TRACING, true);

  if (!tracingEnabled) {
    return {
      enabled: false,
      reason: 'langsmith-tracing-disabled',
    };
  }

  const apiKey = toOptionalString(env.LANGSMITH_API_KEY);

  if (!apiKey) {
    return {
      enabled: false,
      reason: 'langsmith-api-key-missing',
    };
  }

  const endpoint =
    (toOptionalString(env.LANGSMITH_ENDPOINT) ?? DEFAULT_LANGSMITH_ENDPOINT).replace(
      /\/+$/,
      '',
    );
  const projectName = toOptionalString(env.LANGSMITH_PROJECT) ?? DEFAULT_LANGSMITH_PROJECT;
  const workspaceId = toOptionalString(env.LANGSMITH_WORKSPACE_ID);

  return {
    enabled: true,
    reason: null,
    apiKey,
    endpoint,
    projectName,
    workspaceId: workspaceId ?? null,
  };
}

export function createLangSmithTracer({
  env = process.env,
  fetchImpl = fetch,
  logger,
} = {}) {
  const config = resolveLangSmithTraceConfig(env);
  const log = typeof logger === 'function' ? logger : () => {};

  async function requestLangSmith(method, path, payload) {
    if (!config.enabled) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
    };

    if (config.workspaceId) {
      headers['x-tenant-id'] = config.workspaceId;
    }

    try {
      const response = await fetchImpl(`${config.endpoint}${path}`, {
        method,
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const rawBody = await response.text();
        throw new Error(
          `langsmith-api-error:${response.status}:${path}:${rawBody.slice(0, 200)}`,
        );
      }

      return null;
    } catch (error) {
      if (error.name === 'AbortError') {
        log('warn', 'langsmith request timed out', { method, path });
      } else {
        log('warn', 'langsmith request failed', {
          method,
          path,
          error: error?.message ?? 'unknown-error',
        });
      }

      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function startRun({ name, runType = 'chain', inputs = {}, parentRunId, extra } = {}) {
    if (!config.enabled) {
      return null;
    }

    const runId = randomUUID();
    const payload = {
      id: runId,
      name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : 'unnamed-run',
      run_type: runType,
      inputs,
      start_time: nowIsoString(),
      session_name: config.projectName,
    };

    if (typeof parentRunId === 'string' && parentRunId.trim().length > 0) {
      payload.parent_run_id = parentRunId;
    }

    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      payload.extra = extra;
    }

    await requestLangSmith('POST', '/runs', payload);

    return {
      id: runId,
      name: payload.name,
      runType,
    };
  }

  async function endRun(run, outputs = {}) {
    if (!run || typeof run.id !== 'string') {
      return;
    }

    await requestLangSmith('PATCH', `/runs/${run.id}`, {
      outputs,
      end_time: nowIsoString(),
    });
  }

  async function failRun(run, error, outputs = {}) {
    if (!run || typeof run.id !== 'string') {
      return;
    }

    await requestLangSmith('PATCH', `/runs/${run.id}`, {
      outputs,
      error: toTraceError(error),
      end_time: nowIsoString(),
    });
  }

  async function withRun(options, execute) {
    const { mapOutput, ...runOptions } = options ?? {};
    const run = await startRun(runOptions);

    try {
      const value = await execute();
      const outputs = typeof mapOutput === 'function' ? mapOutput(value) : value;
      await endRun(run, outputs);
      return value;
    } catch (error) {
      await failRun(run, error);
      throw error;
    }
  }

  return {
    config,
    isEnabled() {
      return config.enabled;
    },
    reason: config.reason ?? null,
    startRun,
    endRun,
    failRun,
    withRun,
  };
}
