import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { AbstractHttpAdapter } from '@nestjs/core';
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
});
