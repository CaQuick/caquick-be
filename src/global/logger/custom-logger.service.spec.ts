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

  // useLogger 뒤 Nest Logger.log(msg, 'Ctx') / error(msg, stack, 'Ctx')의 꼬리 인자 — 전부 optionalParams로 밀리면 출처(context)를 잃는다
  describe('Nest 꼬리 인자(context·stack)', () => {
    it('마지막 문자열 인자는 context로 싣는다', () => {
      service.log('hello', 'RoutesResolver');
      expect(mockLogger.info).toHaveBeenCalledWith({
        context: 'RoutesResolver',
        message: 'hello',
        optionalParams: [],
      });
    });

    it('error(message, stack, context)는 stack과 context를 각각 싣는다', () => {
      service.error('fail', 'Error: fail\n    at x (a.ts:1:1)', 'Ctx');
      expect(mockLogger.error).toHaveBeenCalledWith({
        context: 'Ctx',
        message: 'fail',
        stack: 'Error: fail\n    at x (a.ts:1:1)',
        optionalParams: [],
      });
    });

    it('error(message, stack)처럼 문자열이 하나뿐이고 스택 모양이면 context가 아니라 stack이다', () => {
      service.error('fail', 'Error: fail\n    at x (a.ts:1:1)');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          context: LogContext.APP,
          stack: 'Error: fail\n    at x (a.ts:1:1)',
        }),
      );
    });

    // 조인 키(eventId 등)가 message 아래·optionalParams[0] 아래로 흩어지지 않게 — plain object 하나는 최상위 필드
    it('꼬리 plain object 하나는 최상위 필드로 펼친다', () => {
      service.warn('slow', { ms: 120, eventId: 'e1' }, 'Ctx');
      expect(mockLogger.warn).toHaveBeenCalledWith({
        context: 'Ctx',
        message: 'slow',
        ms: 120,
        eventId: 'e1',
        optionalParams: [],
      });
    });

    it('반증: 문자열 인자가 없으면 context는 App이고 객체는 그대로 펼친다', () => {
      service.log('hello', { a: 1 });
      expect(mockLogger.info).toHaveBeenCalledWith({
        context: LogContext.APP,
        message: 'hello',
        a: 1,
        optionalParams: [],
      });
    });

    it('반증: 골격 키(message·level·context…)는 덮지 않고 optionalParams에 남긴다', () => {
      service.log('hello', { message: 'x', level: 'error', a: 1 });
      expect(mockLogger.info).toHaveBeenCalledWith({
        context: LogContext.APP,
        message: 'hello',
        a: 1,
        optionalParams: [{ message: 'x', level: 'error' }],
      });
    });

    it('반증: 객체가 둘 이상·배열·Error면 펼치지 않는다', () => {
      const err = new Error('boom');
      service.log('hello', { a: 1 }, { b: 2 });
      service.log('hello', [1, 2]);
      service.log('hello', err);
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ optionalParams: [{ a: 1 }, { b: 2 }] }),
      );
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ optionalParams: [[1, 2]] }),
      );
      expect(mockLogger.info).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          optionalParams: [{ message: 'boom', stack: err.stack }],
        }),
      );
    });

    it('error(message, undefined, context) — Nest가 남기는 빈 stack 자리는 버린다', () => {
      service.error('fail', undefined, 'Ctx');
      expect(mockLogger.error).toHaveBeenCalledWith({
        context: 'Ctx',
        message: 'fail',
        optionalParams: [],
      });
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

    it('optionalParams의 non-Error 값은 그대로 유지된다 (map 삼항 false branch)', () => {
      service.log('x', 'plain string', 42, { k: 'v' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          optionalParams: ['plain string', 42, { k: 'v' }],
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
