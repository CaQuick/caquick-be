import { Injectable, LoggerService } from '@nestjs/common';

import { customLogger } from 'src/global/logger/logger';
import {
  LogContext,
  TransactionErrorPayload,
  TransactionLogPayload,
} from 'src/global/types/log.type';

@Injectable()
export class CustomLoggerService implements LoggerService {
  /**
   * Nest 내부 로그(일반 메시지)
   */
  log(message: unknown, ...optionalParams: unknown[]): void {
    customLogger.info({
      context: LogContext.APP,
      message: this.normalizeMessage(message),
      optionalParams: this.normalizeOptionalParams(optionalParams),
    });
  }

  /**
   * Nest 내부 에러 로그(일반 메시지)
   */
  error(message: unknown, ...optionalParams: unknown[]): void {
    customLogger.error({
      context: LogContext.APP,
      message: this.normalizeMessage(message),
      optionalParams: this.normalizeOptionalParams(optionalParams),
    });
  }

  /**
   * Nest 내부 경고 로그
   */
  warn(message: unknown, ...optionalParams: unknown[]): void {
    customLogger.warn({
      context: LogContext.APP,
      message: this.normalizeMessage(message),
      optionalParams: this.normalizeOptionalParams(optionalParams),
    });
  }

  /**
   * Nest 내부 디버그 로그
   */
  debug(message: unknown, ...optionalParams: unknown[]): void {
    customLogger.debug({
      context: LogContext.APP,
      message: this.normalizeMessage(message),
      optionalParams: this.normalizeOptionalParams(optionalParams),
    });
  }

  /**
   * Nest 내부 상세 로그
   */
  verbose(message: unknown, ...optionalParams: unknown[]): void {
    customLogger.verbose({
      context: LogContext.APP,
      message: this.normalizeMessage(message),
      optionalParams: this.normalizeOptionalParams(optionalParams),
    });
  }

  /**
   * 구조화 트랜잭션 로그
   */
  tx(payload: TransactionLogPayload): void {
    customLogger.info(payload);
  }

  /**
   * 구조화 트랜잭션 에러 로그
   */
  txError(payload: TransactionErrorPayload): void {
    customLogger.error(payload);
  }

  /**
   * 메시지를 안전하게 문자열/객체 형태로 정규화
   */
  private normalizeMessage(message: unknown): unknown {
    if (message instanceof Error) {
      return { message: message.message, stack: message.stack };
    }
    return message;
  }

  /**
   * optionalParams 정규화
   */
  private normalizeOptionalParams(optionalParams: unknown[]): unknown[] {
    return optionalParams.map((p) =>
      p instanceof Error ? this.normalizeMessage(p) : p,
    );
  }
}
