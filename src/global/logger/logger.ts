import type { TransformableInfo } from 'logform';
import { createLogger, format, transports, type Logger } from 'winston';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * 개발 환경용 로그 포맷
 */
const devFormat = format.printf(
  (info: TransformableInfo & { timestamp?: string }) => {
    const ts = info.timestamp ?? new Date().toISOString();
    const lvl = String(info.level);
    const { level, timestamp, message, ...meta } = info as Record<
      string,
      unknown
    >;
    if (typeof message === 'string') {
      const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${ts} ${lvl}: ${message}${rest}`;
    }
    return `${ts} ${lvl}: ${JSON.stringify(meta)}`;
  },
);

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
