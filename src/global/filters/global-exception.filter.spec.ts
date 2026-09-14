import { BadRequestException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter, type AbstractHttpAdapter } from '@nestjs/core';
import type { Request, Response } from 'express';

import { domainError, messageOf } from '@/common/errors';
import { HttpExceptionFilter } from '@/global/filters/global-exception.filter';
import { GraphQLExceptionFilter } from '@/global/filters/graphql-exception.filter';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';

jest.mock('@/global/logger/logger', () => ({
  customLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
}));

function mockReq(): Request {
  return {
    headers: {},
    method: 'GET',
    path: '/test',
    originalUrl: '/test',
    query: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function mockHost(req: Request, res: Response) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => jest.fn(),
    }),
    getArgs: () => [req, res],
    getArgByIndex: (i: number) => [req, res][i],
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
  } as never;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let logger: CustomLoggerService;
  let gqlFilter: GraphQLExceptionFilter;

  beforeEach(() => {
    logger = new CustomLoggerService();
    logger.txError = jest.fn();
    gqlFilter = new GraphQLExceptionFilter(logger);
    gqlFilter.format = jest
      .fn()
      .mockReturnValue(new Error('mock graphql error'));
    const adapter = {} as AbstractHttpAdapter;
    filter = new HttpExceptionFilter(adapter, logger, gqlFilter);
  });

  it('BadRequestException이면 에러 응답을 반환한다', () => {
    const req = mockReq();
    const res = mockRes();
    const host = mockHost(req, res);

    filter.catch(new BadRequestException('bad input'), host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'bad input', code: 400 }),
    );
    expect(logger.txError).toHaveBeenCalled();
  });

  it('일반 Error이면 500 응답을 반환한다', () => {
    const req = mockReq();
    const res = mockRes();
    const host = mockHost(req, res);

    filter.catch(new Error('unexpected'), host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 500 }),
    );
  });

  it('ValidationError가 포함된 BadRequestException이면 데이터 포함 응답을 반환한다', () => {
    const req = mockReq();
    const res = mockRes();
    const host = mockHost(req, res);

    const exception = new BadRequestException({
      message: [
        { property: 'email', constraints: { isEmail: 'must be email' } },
      ],
    });

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Validation Error',
        data: [
          { property: 'email', constraints: { isEmail: 'must be email' } },
        ],
      }),
    );
  });

  it('BadRequestException의 message가 배열이지만 validation 형태가 아니면 기본 ERROR 응답', () => {
    const req = mockReq();
    const res = mockRes();
    const host = mockHost(req, res);

    const exception = new BadRequestException({
      // 배열이지만 validation 구조({property, constraints}) 아님
      message: ['plain string', 'another'],
    });

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    // ERROR 헬퍼로 직렬화 → data는 null
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 400, data: null }),
    );
  });

  it('BadRequestException resp가 object이지만 message 속성이 없으면 기본 ERROR', () => {
    const req = mockReq();
    const res = mockRes();
    const host = mockHost(req, res);

    // BadRequestException에 message 없는 object
    const exception = new BadRequestException({ statusCode: 400 });

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 400 }),
    );
  });

  it('GraphQL 컨텍스트에서는 GraphQLExceptionFilter.format 에 위임하고 GraphQL 에러를 반환한다', () => {
    const host = {
      getType: () => 'graphql',
    } as never;
    const exception = new Error('gql');

    const result = filter.catch(exception, host);

    // 1) gqlFilter.format 에 그대로 위임
    expect(gqlFilter.format).toHaveBeenCalledTimes(1);
    expect(gqlFilter.format).toHaveBeenCalledWith(exception, host);
    // 2) format 결과를 그대로 반환 (Apollo 가 응답에 포함)
    expect(result).toBe(
      (gqlFilter.format as jest.Mock).mock.results[0].value as Error,
    );
    // 3) HTTP 경로 side effect 없음
    expect(logger.txError).not.toHaveBeenCalled();
  });

  it('http/graphql 외 컨텍스트는 BaseExceptionFilter.catch 로 위임한다', () => {
    const superCatch = jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined);
    try {
      const host = {
        getType: () => 'rpc',
      } as never;
      const exception = new Error('rpc');

      filter.catch(exception, host);

      expect(superCatch).toHaveBeenCalledTimes(1);
      expect(superCatch).toHaveBeenCalledWith(exception, host);
      expect(gqlFilter.format).not.toHaveBeenCalled();
      expect(logger.txError).not.toHaveBeenCalled();
    } finally {
      superCatch.mockRestore();
    }
  });

  /**
   * REST 응답에도 도메인 코드를 싣는다. auth 는 REST 전용이라 여기서 빠지면
   * 카탈로그를 도입한 목적(문구가 아니라 코드로 분기)이 그 경로에 닿지 않는다.
   */
  describe('errorCode 전달', () => {
    it('카탈로그 예외는 errorCode 를 응답에 싣는다', () => {
      const req = mockReq();
      const res = mockRes();

      filter.catch(domainError('INVALID_CREDENTIALS'), mockHost(req, res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: 'INVALID_CREDENTIALS',
          message: messageOf('INVALID_CREDENTIALS'),
          code: HttpStatus.UNAUTHORIZED,
        }),
      );
    });

    it('카탈로그를 거치지 않은 예외는 응답에 errorCode 가 실리지 않는다', () => {
      const req = mockReq();
      const res = mockRes();

      filter.catch(new BadRequestException('bad input'), mockHost(req, res));

      // 클래스 필드 선언은 값이 undefined여도 속성 자체는 만든다(useDefineForClassFields).
      // 클라이언트가 보는 것은 직렬화 결과이므로 그 수준에서 확인한다.
      const payload = (res.json as jest.Mock).mock.calls[0]?.[0] as object;
      expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty(
        'errorCode',
      );
    });

    it('카탈로그 예외는 직렬화 후에도 errorCode 가 남는다', () => {
      const req = mockReq();
      const res = mockRes();

      filter.catch(domainError('MISSING_REFRESH_TOKEN'), mockHost(req, res));

      const payload = (res.json as jest.Mock).mock.calls[0]?.[0] as object;
      expect(JSON.parse(JSON.stringify(payload))).toMatchObject({
        errorCode: 'MISSING_REFRESH_TOKEN',
      });
    });
  });
});
