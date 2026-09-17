import { Injectable, LoggerService } from '@nestjs/common';

import { customLogger } from '@/global/logger/logger';
import {
  LogContext,
  TransactionErrorPayload,
  TransactionLogPayload,
} from '@/global/types/log.type';

@Injectable()
export class CustomLoggerService implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    customLogger.info({
      context: LogContext.APP,
      message: this.normalizeMessage(message),
      optionalParams: this.normalizeOptionalParams(optionalParams),
    });
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    customLogger.error({
      context: LogContext.APP,
      message: this.normalizeMessage(message),
      optionalParams: this.normalizeOptionalParams(optionalParams),
    });
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    customLogger.warn({
      context: LogContext.APP,
      message: this.normalizeMessage(message),
      optionalParams: this.normalizeOptionalParams(optionalParams),
    });
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    customLogger.debug({
      context: LogContext.APP,
      message: this.normalizeMessage(message),
      optionalParams: this.normalizeOptionalParams(optionalParams),
    });
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    customLogger.verbose({
      context: LogContext.APP,
      message: this.normalizeMessage(message),
      optionalParams: this.normalizeOptionalParams(optionalParams),
    });
  }

  tx(payload: TransactionLogPayload): void {
    customLogger.info(payload);
  }

  txError(payload: TransactionErrorPayload): void {
    customLogger.error(payload);
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
