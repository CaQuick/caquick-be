import { Injectable, LoggerService } from '@nestjs/common';

import { customLogger } from '@/global/logger/logger';
import {
  LogContext,
  TransactionErrorPayload,
  TransactionLogPayload,
} from '@/global/types/log.type';

type Level = 'info' | 'error' | 'warn' | 'debug' | 'verbose';

/** 펼친 필드가 로그 골격을 덮지 않게 — 이 키들은 optionalParams에 남긴다. */
const RESERVED_FIELDS = new Set([
  'level',
  'message',
  'context',
  'timestamp',
  'stack',
  'optionalParams',
]);

/**
 * Nest Logger 규칙: 마지막 문자열 인자가 context(클래스명), error()는 그 앞 문자열이 stack(Nest는 stack이 없으면
 * undefined 자리를 남긴다). 남은 인자 중 plain object가 하나뿐이면 최상위 필드로 펼친다 — 발행·소비·실패 로그의
 * eventId 같은 조인 키가 message 아래나 optionalParams[0] 아래로 흩어지지 않게(Loki `| json` 기준 한 이름).
 */
function splitNestParams(
  params: unknown[],
  withStack: boolean,
): {
  context?: string;
  stack?: string;
  fields: Record<string, unknown>;
  rest: unknown[];
} {
  const rest = [...params];
  let context: string | undefined;
  let stack: string | undefined;
  const last = rest[rest.length - 1];
  if (typeof last === 'string' && (!withStack || !looksLikeStack(last))) {
    context = rest.pop() as string;
  }
  if (withStack) {
    const next = rest[rest.length - 1];
    if (typeof next === 'string') stack = rest.pop() as string;
    else if (next === undefined && rest.length > 0) rest.pop();
  }
  let fields: Record<string, unknown> = {};
  if (rest.length === 1 && isPlainObject(rest[0])) {
    const [only] = rest.splice(0, 1) as [Record<string, unknown>];
    const reserved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(only)) {
      if (RESERVED_FIELDS.has(key)) reserved[key] = value;
      else fields[key] = value;
    }
    if (Object.keys(reserved).length > 0) rest.push(reserved);
    if (Object.keys(fields).length === 0) fields = {};
  }
  return { context, stack, fields, rest };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Error) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** error(message, stack) 꼴 — 인자가 하나뿐일 때 스택 텍스트를 context로 오인하지 않게 */
function looksLikeStack(value: string): boolean {
  return /\n\s+at .+:\d+:\d+/.test(value) || value.includes('\n    at ');
}

@Injectable()
export class CustomLoggerService implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams, true);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  tx(payload: TransactionLogPayload): void {
    customLogger.info(payload);
  }

  txError(payload: TransactionErrorPayload): void {
    customLogger.error(payload);
  }

  /** app.useLogger 뒤 Nest 내부 로그(Logger.log(msg, 'ClassName'))의 출처를 잃지 않게 꼬리 인자를 벗겨 필드로 싣는다. */
  private write(
    level: Level,
    message: unknown,
    optionalParams: unknown[],
    withStack = false,
  ): void {
    const { context, stack, fields, rest } = splitNestParams(
      optionalParams,
      withStack,
    );
    customLogger[level]({
      ...fields,
      context: context ?? LogContext.APP,
      message: this.normalizeMessage(message),
      ...(stack !== undefined ? { stack } : {}),
      optionalParams: this.normalizeOptionalParams(rest),
    });
  }

  private normalizeMessage(message: unknown): unknown {
    if (message instanceof Error) {
      return { message: message.message, stack: message.stack };
    }
    return message;
  }

  private normalizeOptionalParams(optionalParams: unknown[]): unknown[] {
    return optionalParams.map((p) =>
      p instanceof Error ? this.normalizeMessage(p) : p,
    );
  }
}
