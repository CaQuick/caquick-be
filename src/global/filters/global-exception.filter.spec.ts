import { BadRequestException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter, type AbstractHttpAdapter } from '@nestjs/core';
import type { Request, Response } from 'express';

import { HttpExceptionFilter } from '@/global/filters/global-exception.filter';
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

  beforeEach(() => {
    logger = new CustomLoggerService();
    logger.txError = jest.fn();
    const adapter = {} as AbstractHttpAdapter;
    filter = new HttpExceptionFilter(adapter, logger);
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
    const exception = new BadRequestException({ statusCode: 400 } as never);

    filter.catch(exception, host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 400 }),
    );
  });

  it('GraphQL 컨텍스트(getType !== "http")에서는 BaseExceptionFilter.catch로 위임하고 로깅을 스킵한다', () => {
    const superCatch = jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined);

    try {
      const host = {
        getType: () => 'graphql',
        switchToHttp: () => ({
          getRequest: () => ({}),
          getResponse: () => ({}),
        }),
      } as never;
      const exception = new Error('gql');

      filter.catch(exception, host);

      // 1) super.catch로 정확히 위임됐는지 — exception/host 원본 그대로 전달
      expect(superCatch).toHaveBeenCalledTimes(1);
      expect(superCatch).toHaveBeenCalledWith(exception, host);
      // 2) HTTP 경로의 side effect가 일어나지 않았는지
      expect(logger.txError).not.toHaveBeenCalled();
    } finally {
      superCatch.mockRestore();
    }
  });
});
