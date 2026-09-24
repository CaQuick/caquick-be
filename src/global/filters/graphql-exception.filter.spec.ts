import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { GraphQLError } from 'graphql';

import { DomainException } from '@/common/errors/error-catalog';
import { classifyStatus } from '@/common/utils/error';
import { GraphQLExceptionFilter } from '@/global/filters/graphql-exception.filter';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { MetricsService } from '@/global/metrics/metrics.service';

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
  parentType = 'Query',
): ArgumentsHost {
  // GqlArgumentsHost.create(host) reads host.getArgs() — 4-tuple [root, args, context, info]
  const info = {
    fieldName,
    operation: { operation },
    path: { key: fieldName },
    parentType: { toString: () => parentType },
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

  let metrics: MetricsService;

  beforeEach(() => {
    logger = new CustomLoggerService();
    logger.txError = jest.fn();
    metrics = new MetricsService();
    filter = new GraphQLExceptionFilter(logger, metrics);
  });

  // 인터셉터는 가드 뒤에 돌아 401·403을 못 본다 — 실패 관측은 필터가, outcome은 유한한 분류
  it('실패를 type·field·outcome(분류) 라벨로 관측한다', async () => {
    filter.format(new ForbiddenException(), mockHost('sellerMyStore'));
    filter.format(new Error('boom'), mockHost('sellerMyStore'));

    const text = await metrics.text();
    expect(text).toContain(
      'caquick_graphql_root_field_duration_seconds_count{type="Query",field="sellerMyStore",outcome="FORBIDDEN"} 1',
    );
    expect(text).toContain(
      'caquick_graphql_root_field_duration_seconds_count{type="Query",field="sellerMyStore",outcome="INTERNAL_SERVER_ERROR"} 1',
    );
  });

  it('반증: 구독(Subscription)·하위 필드 실패는 관측하지 않는다 — 인터셉터가 성공을 세지 않는 범위라 실패만 남으면 오류율이 왜곡된다', async () => {
    filter.format(
      new ForbiddenException(),
      mockHost('conversationUpdated', 'query', {}, 'Subscription'),
    );
    filter.format(new Error('x'), mockHost('items', 'query', {}, 'Store'));

    expect(await metrics.text()).not.toMatch(/type="(Subscription|Store)"/);
  });

  describe('classifyStatus', () => {
    it.each([
      [HttpStatus.BAD_REQUEST, 'BAD_USER_INPUT'],
      [HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED'],
      [HttpStatus.FORBIDDEN, 'FORBIDDEN'],
      [HttpStatus.NOT_FOUND, 'NOT_FOUND'],
      [HttpStatus.CONFLICT, 'CONFLICT'],
      [HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_SERVER_ERROR'],
      [418, 'INTERNAL_SERVER_ERROR'],
    ])('%i → %s', (status, expected) => {
      expect(classifyStatus(status)).toBe(expected);
    });
  });

  describe('format', () => {
    it.each([
      ['STORE_NOT_FOUND', 404, 'NOT_FOUND'],
      ['INVALID_CURSOR', 400, 'BAD_USER_INPUT'],
      ['AUTHENTICATION_REQUIRED', 401, 'UNAUTHENTICATED'],
      ['USER_ONLY', 403, 'FORBIDDEN'],
      ['NICKNAME_TAKEN', 409, 'CONFLICT'],
      ['S3_PRESIGN_FAILED', 500, 'INTERNAL_SERVER_ERROR'],
    ] as const)(
      'DomainException(%s) → code는 카탈로그 코드, classification=%s',
      (code, status, classification) => {
        const exception = new DomainException(code);
        const result = filter.format(exception, mockHost());

        expect(result.message).toBe(exception.message);
        expect(result.extensions).toEqual(
          expect.objectContaining({
            code,
            classification,
            statusCode: status,
          }),
        );
      },
    );

    it('ValidationPipe 예외는 VALIDATION_FAILED', () => {
      const exception = new BadRequestException({
        message: [{ property: 'email', constraints: { isEmail: 'bad' } }],
      });
      const result = filter.format(exception, mockHost());

      expect(result.message).toBe('입력값이 올바르지 않습니다.');
      expect(result.extensions).toEqual(
        expect.objectContaining({
          code: 'VALIDATION_FAILED',
          classification: 'BAD_USER_INPUT',
          statusCode: 400,
        }),
      );
    });

    // 카탈로그 밖 Nest 예외(앱 코드는 ESLint가 막음): 라우터 404만 ROUTE_NOT_FOUND, 나머지는 INTERNAL_ERROR
    it.each([
      [
        new BadRequestException('bad input'),
        400,
        'INTERNAL_ERROR',
        'BAD_USER_INPUT',
        'bad input',
      ],
      [
        new UnauthorizedException('no token'),
        401,
        'INTERNAL_ERROR',
        'UNAUTHENTICATED',
        'no token',
      ],
      [
        new ForbiddenException('nope'),
        403,
        'INTERNAL_ERROR',
        'FORBIDDEN',
        'nope',
      ],
      [
        new NotFoundException('Cannot GET /x'),
        404,
        'ROUTE_NOT_FOUND',
        'NOT_FOUND',
        'Cannot GET /x',
      ],
    ])(
      '%p → statusCode=%i, code=%s, classification=%s, message=%s',
      (exception, status, code, classification, message) => {
        const host = mockHost();
        const result = filter.format(exception, host);

        expect(result).toBeInstanceOf(GraphQLError);
        expect(result.message).toBe(message);
        expect(result.extensions).toEqual(
          expect.objectContaining({
            code,
            classification,
            statusCode: status,
            operation: 'query',
            fieldName: 'sellerMyStore',
          }),
        );
      },
    );

    it('일반 Error 는 INTERNAL_ERROR (500) 으로 매핑된다', () => {
      const host = mockHost();
      const result = filter.format(new Error('boom'), host);

      expect(result.extensions).toEqual(
        expect.objectContaining({
          code: 'INTERNAL_ERROR',
          classification: 'INTERNAL_SERVER_ERROR',
          statusCode: 500,
        }),
      );
    });

    it('Error 가 아닌 throw (예: string) 도 INTERNAL_ERROR 로 안전하게 매핑된다', () => {
      // stack 추출 분기에서 exception !instanceof Error 경로 커버
      const host = mockHost();
      const result = filter.format('plain string thrown', host);

      expect(result.extensions).toEqual(
        expect.objectContaining({
          code: 'INTERNAL_ERROR',
          classification: 'INTERNAL_SERVER_ERROR',
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
