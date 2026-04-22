import type { TransformableInfo } from 'logform';
import { createLogger, format, transports, type Logger } from 'winston';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * 개발 환경용 로그 포맷에 사용되는 pure printf 콜백. 테스트 가능하도록 export.
 *
 * - string message: `${message}${meta-json}` 형식으로 출력
 * - non-string message(객체/에러/bigint 등): message를 meta의 `message` 키로 보존하여 함께 직렬화
 *   → `${JSON.stringify({ message, ...meta })}` 형태
 * - bigint 안전: JSON.stringify의 replacer로 bigint를 문자열로 변환해 throw 방지
 */
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
  // non-string message는 버리지 않고 meta와 합쳐 직렬화한다.
  const payload: Record<string, unknown> = { message, ...meta };
  return `${ts} ${lvl}: ${safeJsonStringify(payload)}`;
}

/**
 * JSON.stringify + bigint 안전 replacer.
 * bigint는 JSON으로 직렬화할 수 없어 기본 stringify가 throw하므로, 문자열로 변환한다.
 */
function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key: string, v: unknown): unknown =>
    typeof v === 'bigint' ? v.toString() : v,
  );
}

/**
 * 개발 환경용 로그 포맷
 */
const devFormat = format.printf(formatDevLogLine);

/**
 * 콘솔 출력용 트랜스포트 설정
 */
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
