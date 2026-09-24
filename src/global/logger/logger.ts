import type { TransformableInfo } from 'logform';
import { createLogger, format, transports, type Logger } from 'winston';

import { resolveAppRole } from '@/config/app.config';
import { requestContextStorage } from '@/global/request-context/request-context.service';

const isProduction = process.env.NODE_ENV === 'production';

/** non-string message(객체/에러/bigint)는 meta의 message 키로 보존해 함께 직렬화하고, bigint는 replacer로 문자열화해 throw를 막는다. 테스트 가능하도록 export. */
export function formatDevLogLine(
  info: TransformableInfo & { timestamp?: string },
): string {
  const ts = info.timestamp ?? new Date().toISOString();
  const lvl = String(info.level);
  const { level, timestamp, message, ...meta } = info as Record<
    string,
    unknown
  >;
  if (typeof message === 'string') {
    const rest = Object.keys(meta).length ? ` ${safeJsonStringify(meta)}` : '';
    return `${ts} ${lvl}: ${message}${rest}`;
  }
  const payload: Record<string, unknown> = { message, ...meta };
  return `${ts} ${lvl}: ${safeJsonStringify(payload)}`;
}

/** bigint는 JSON으로 직렬화할 수 없어 기본 stringify가 throw하므로 문자열로 변환한다. */
function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key: string, v: unknown): unknown =>
    typeof v === 'bigint' ? v.toString() : v,
  );
}

const devFormat = format.printf(formatDevLogLine);

/** 요청 안에서 찍힌 줄에 requestId를 싣는다 — api↔worker 로그를 이어 보는 열쇠(P2 E8). 명시된 값이 있으면 그대로 둔다. */
const withRequestId = format((info) => {
  const requestId = requestContextStorage.getStore()?.requestId;
  if (requestId && info.requestId === undefined) info.requestId = requestId;
  return info;
});

const consoleTransport = new transports.Console({
  format: isProduction
    ? format.combine(
        withRequestId(),
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
        format.errors({ stack: false }),
        format.json(),
      )
    : format.combine(
        withRequestId(),
        format.colorize({
          all: true,
          colors: {
            info: 'green',
            warn: 'yellow',
            error: 'red',
            debug: 'magenta',
          },
        }),
        format.errors({ stack: true }),
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
        devFormat,
      ),
});

export const customLogger: Logger = createLogger({
  level: isProduction ? 'info' : 'debug',
  // 운영은 한 줄 JSON(Alloy·Loki가 줄 단위로 읽는다) + 역할 라벨. 개발 출력은 사람이 보므로 붙이지 않는다.
  ...(isProduction ? { defaultMeta: { role: resolveAppRole() } } : {}),
  transports: [consoleTransport],
});
