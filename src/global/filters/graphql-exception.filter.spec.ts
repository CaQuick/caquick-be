import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { GraphQLError } from 'graphql';

import {
  GraphQLExceptionFilter,
  mapStatusToCode,
} from '@/global/filters/graphql-exception.filter';
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

function mockHost(
  fieldName = 'sellerMyStore',
  operation: 'query' | 'mutation' = 'query',
  reqHeaders: Record<string, string> = {},
): ArgumentsHost {
  // GqlArgumentsHost.create(host) reads host.getArgs() — 4-tuple [root, args, context, info]
  const info = {
    fieldName,
    operation: { operation },
    path: { key: fieldName },
    parentType: { toString: () => 'Query' },
  };
  const context = {
    req: {
      headers: reqHeaders,
      socket: { remoteAddress: '127.0.0.1' },
    },
  };
  return {
    getType: () => 'graphql',
    getArgs: () => [null, {}, context, info],
    getArgByIndex: (i: number) => [null, {}, context, info][i],
    switchToHttp: () => ({}),
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
  } as unknown as ArgumentsHost;
}

describe('GraphQLExceptionFilter', () => {
  let filter: GraphQLExceptionFilter;
  let logger: CustomLoggerService;

  beforeEach(() => {
    logger = new CustomLoggerService();
    logger.txError = jest.fn();
    filter = new GraphQLExceptionFilter(logger);
  });

  describe('mapStatusToCode', () => {
    it.each([
      [HttpStatus.BAD_REQUEST, 'BAD_USER_INPUT'],
      [HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED'],
      [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
      [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
      [HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_SERVER_ERROR'],
      [418, 'INTERNAL_SERVER_ERROR'],
    ])('%i → %s', (status, expected) => {
      expect(mapStatusToCode(status)).toBe(expected);
    });
  });

  describe('format', () => {
    it.each([
      [
        new BadRequestException('bad input'),
        400,
        'BAD_USER_INPUT',
        'bad input',
      ],
      [
        new UnauthorizedException('no token'),
        401,
        'UNAUTHENTICATED',
        'no token',
      ],
      [new ForbiddenException('nope'), 403, 'FORBIDDEN', 'nope'],
      [new NotFoundException('missing'), 404, 'NOT_FOUND', 'missing'],
    ])(
      '%p → statusCode=%i, code=%s, message=%s',
      (exception, status, code, message) => {
        const host = mockHost();
        const result = filter.format(exception, host);

        expect(result).toBeInstanceOf(GraphQLError);
        expect(result.message).toBe(message);
        expect(result.extensions).toEqual(
          expect.objectContaining({
            code,
            statusCode: status,
            operation: 'query',
            fieldName: 'sellerMyStore',
          }),
        );
      },
    );

    it('일반 Error 는 INTERNAL_SERVER_ERROR (500) 으로 매핑된다', () => {
      const host = mockHost();
      const result = filter.format(new Error('boom'), host);

      expect(result.extensions).toEqual(
        expect.objectContaining({
          code: 'INTERNAL_SERVER_ERROR',
          statusCode: 500,
        }),
      );
    });

    it('Error 가 아닌 throw (예: string) 도 INTERNAL_SERVER_ERROR 로 안전하게 매핑된다', () => {
      // stack 추출 분기에서 exception !instanceof Error 경로 커버
      const host = mockHost();
      const result = filter.format('plain string thrown', host);

      expect(result.extensions).toEqual(
        expect.objectContaining({
          code: 'INTERNAL_SERVER_ERROR',
          statusCode: 500,
        }),
      );
      // resolveMessage 가 fallback 'Internal Server Error' 반환
      expect(result.message).toBe('Internal Server Error');
    });

    it('extensions.requestId 에 incoming x-request-id 를 사용한다', () => {
      const host = mockHost('sellerProducts', 'query', {
        'x-request-id': 'req-abc-123',
      });
      const result = filter.format(new BadRequestException('x'), host);

      expect(result.extensions?.requestId).toBe('req-abc-123');
    });

    it('x-request-id 가 없으면 새 requestId 가 생성된다 (UUID 형태)', () => {
      const host = mockHost();
      const result = filter.format(new BadRequestException('x'), host);

      expect(typeof result.extensions?.requestId).toBe('string');
      expect(
        (result.extensions?.requestId as string).length,
      ).toBeGreaterThanOrEqual(8);
    });

    it('mutation operation 도 정확히 반영된다', () => {
      const host = mockHost('sellerCreateProduct', 'mutation');
      const result = filter.format(new BadRequestException('x'), host);

      expect(result.extensions).toEqual(
        expect.objectContaining({
          operation: 'mutation',
          fieldName: 'sellerCreateProduct',
        }),
      );
    });

    it('txError 로 구조화 로그를 남긴다', () => {
      const host = mockHost('sellerProducts');
      filter.format(new BadRequestException('bad'), host);

      expect(logger.txError).toHaveBeenCalledTimes(1);
      expect(logger.txError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ statusCode: 400, message: 'bad' }),
        }),
      );
    });
  });
});
