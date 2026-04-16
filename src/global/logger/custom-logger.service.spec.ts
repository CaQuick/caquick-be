// winston 로거를 모킹하여 실제 출력 방지
jest.mock('@/global/logger/logger', () => ({
  customLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
}));

import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { customLogger } from '@/global/logger/logger';
import { LogContext } from '@/global/types/log.type';

const mockLogger = customLogger as jest.Mocked<typeof customLogger>;

describe('CustomLoggerService', () => {
  let service: CustomLoggerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomLoggerService();
  });

  describe('Nest LoggerService 메서드', () => {
    it('log()가 info 레벨로 기록한다', () => {
      service.log('hello');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          context: LogContext.APP,
          message: 'hello',
        }),
      );
    });

    it('error()가 error 레벨로 기록한다', () => {
      service.error('fail');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          context: LogContext.APP,
          message: 'fail',
        }),
      );
    });

    it('warn()이 warn 레벨로 기록한다', () => {
      service.warn('caution');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('debug()가 debug 레벨로 기록한다', () => {
      service.debug('trace');
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('verbose()가 verbose 레벨로 기록한다', () => {
      service.verbose('detail');
      expect(mockLogger.verbose).toHaveBeenCalled();
    });
  });

  describe('메시지 정규화', () => {
    it('Error 객체를 message + stack으로 변환한다', () => {
      const err = new Error('oops');
      service.log(err);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({ message: 'oops' }),
        }),
      );
    });

    it('optionalParams의 Error도 정규화한다', () => {
      const err = new Error('extra');
      service.error('main', err);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          optionalParams: [expect.objectContaining({ message: 'extra' })],
        }),
      );
    });
  });

  describe('트랜잭션 로그', () => {
    it('tx()가 info 레벨로 기록한다', () => {
      service.tx({
        userId: 1,
        requestId: 'req-1',
        request: {} as never,
        context: LogContext.GRAPHQL,
      });
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('txError()가 error 레벨로 기록한다', () => {
      service.txError({
        userId: 1,
        requestId: 'req-1',
        request: {} as never,
        context: LogContext.REST,
        error: { message: 'err' },
      });
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
