import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import { DocsAccessMiddleware } from './docs-access.middleware';

type MockResponse = Pick<Response, 'status' | 'json' | 'setHeader'> & {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
};

const createResponse = (): MockResponse =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
  }) as unknown as MockResponse;

const createNext = (): NextFunction => jest.fn() as unknown as NextFunction;

describe('DocsAccessMiddleware', () => {
  const docsToken = 'docs_token_value';

  it('토큰이 없으면 요청을 통과해야 한다', () => {
    const configService = {
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService;
    const middleware = new DocsAccessMiddleware(configService);
    const req = { headers: {} } as Request;
    const res = createResponse();
    const next = createNext();

    middleware.use(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('Bearer 토큰이 일치하면 통과해야 한다', () => {
    const configService = {
      get: jest.fn().mockReturnValue(docsToken),
    } as unknown as ConfigService;
    const middleware = new DocsAccessMiddleware(configService);
    const req = {
      headers: { authorization: `Bearer ${docsToken}` },
    } as Request;
    const res = createResponse();
    const next = createNext();

    middleware.use(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('Basic 토큰이 일치하면 통과해야 한다', () => {
    const configService = {
      get: jest.fn().mockReturnValue(docsToken),
    } as unknown as ConfigService;
    const middleware = new DocsAccessMiddleware(configService);
    const basic = Buffer.from(`dev:${docsToken}`).toString('base64');
    const req = {
      headers: { authorization: `Basic ${basic}` },
    } as Request;
    const res = createResponse();
    const next = createNext();

    middleware.use(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('토큰이 없으면 401을 반환해야 한다', () => {
    const configService = {
      get: jest.fn().mockReturnValue(docsToken),
    } as unknown as ConfigService;
    const middleware = new DocsAccessMiddleware(configService);
    const req = { headers: {} } as Request;
    const res = createResponse();
    const next = createNext();

    middleware.use(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
  });

  it('토큰이 다르면 401을 반환해야 한다', () => {
    const configService = {
      get: jest.fn().mockReturnValue(docsToken),
    } as unknown as ConfigService;
    const middleware = new DocsAccessMiddleware(configService);
    const req = {
      headers: { authorization: 'Bearer wrong-token' },
    } as Request;
    const res = createResponse();
    const next = createNext();

    middleware.use(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
  });
});
