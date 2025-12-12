import { Injectable, LoggerService } from '@nestjs/common';

import { customLogger } from 'src/global/logger/logger';
import {
  LogContext,
  TransactionErrorPayload,
  TransactionLogPayload,
} from 'src/global/types/log.type';

@Injectable()
export class CustomLoggerService implements LoggerService {
  log(payload: TransactionLogPayload) {
    customLogger.info(payload);
  }
  error(payload: TransactionErrorPayload) {
    customLogger.error(payload);
  }
  warn(message: string, context: LogContext = LogContext.DEFAULT) {
    customLogger.warn({ message, context });
  }
  debug(message: string, context: LogContext = LogContext.DEFAULT) {
    customLogger.debug({ message, context });
  }
  verbose(message: string, context: LogContext = LogContext.DEFAULT) {
    customLogger.verbose({ message, context });
  }
}
