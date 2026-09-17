import type { TransformableInfo } from 'logform';
import { createLogger, format, transports, type Logger } from 'winston';

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

const consoleTransport = new transports.Console({
  format: isProduction
    ? format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
        format.errors({ stack: false }),
        format.json({ space: 2 }),
      )
    : format.combine(
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
  transports: [consoleTransport],
});
