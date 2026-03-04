import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Client } from 'langsmith';

const DEFAULT_LANGSMITH_ENDPOINT = 'https://api.smith.langchain.com';
const DEFAULT_LANGSMITH_PROJECT = 'caquick-pr-ai-description';
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
  logger,
  client,
  clientFactory,
} = {}) {
  const config = resolveLangSmithTraceConfig(env);
  const log = typeof logger === 'function' ? logger : () => {};
  const tracingClient =
    config.enabled &&
    (client ??
      (typeof clientFactory === 'function'
        ? clientFactory({
            apiKey: config.apiKey,
            apiUrl: config.endpoint,
            workspaceId: config.workspaceId ?? undefined,
            autoBatchTracing: false,
          })
        : new Client({
            apiKey: config.apiKey,
            apiUrl: config.endpoint,
            workspaceId: config.workspaceId ?? undefined,
            autoBatchTracing: false,
          })));

  function toKvMap(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }

    if (value === undefined) {
      return {};
    }

    return {
      value,
    };
  }

  async function requestLangSmith(action, execute) {
    if (!config.enabled || !tracingClient) {
      return null;
    }

    try {
      await execute();
      return null;
    } catch (error) {
      log('warn', 'langsmith sdk request failed', {
        action,
        error: error?.message ?? 'unknown-error',
      });

      return null;
    }
  }

  async function startRun({ name, runType = 'chain', inputs = {}, parentRunId, extra } = {}) {
    if (!config.enabled || !tracingClient) {
      return null;
    }

    const runId = randomUUID();
    const payload = {
      id: runId,
      name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : 'unnamed-run',
      run_type: runType,
      inputs: toKvMap(inputs),
      start_time: nowIsoString(),
      project_name: config.projectName,
    };

    if (typeof parentRunId === 'string' && parentRunId.trim().length > 0) {
      payload.parent_run_id = parentRunId;
    }

    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      payload.extra = extra;
    }

    await requestLangSmith('createRun', async () => {
      await tracingClient.createRun(payload);
    });

    return {
      id: runId,
      name: payload.name,
      runType,
    };
  }

  async function endRun(run, outputs = {}) {
    if (!run || typeof run.id !== 'string' || !tracingClient) {
      return;
    }

    await requestLangSmith('updateRun', async () => {
      await tracingClient.updateRun(run.id, {
        outputs: toKvMap(outputs),
        end_time: nowIsoString(),
      });
    });
  }

  async function failRun(run, error, outputs = {}) {
    if (!run || typeof run.id !== 'string' || !tracingClient) {
      return;
    }

    await requestLangSmith('updateRun', async () => {
      await tracingClient.updateRun(run.id, {
        outputs: toKvMap(outputs),
        error: toTraceError(error),
        end_time: nowIsoString(),
      });
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
