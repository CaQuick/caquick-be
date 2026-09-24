import type { Request, Response } from 'express';
import type { GraphQLResolveInfo } from 'graphql';

import {
  buildGraphqlRequestMeta,
  buildHttpRequestMeta,
  calculateDuration,
  ensureRequestTracking,
  REQUEST_ID_HEADER,
  RESPONSE_TIME_HEADER,
  resolveUserId,
  setResponseTimeHeader,
} from '@/common/utils/request-context';

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    headers: {},
    method: 'GET',
    path: '/test',
    originalUrl: '/test?q=1',
    query: { q: '1' },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    _headers: headers,
    headersSent: false,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  } as unknown as Response & { _headers: Record<string, string> };
}

describe('request-context', () => {
  describe('ensureRequestTracking', () => {
    it('requestId가 없으면 UUID를 생성한다', () => {
      const req = mockReq();
      const res = mockRes();
      const { requestId } = ensureRequestTracking(req, res);
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('기존 x-request-id 헤더가 있으면 그 값을 사용한다', () => {
      const req = mockReq({
        headers: { [REQUEST_ID_HEADER]: 'existing-id' },
      });
      const { requestId } = ensureRequestTracking(req);
      expect(requestId).toBe('existing-id');
    });

    // 클라이언트 값은 로그·응답 헤더에 그대로 실린다 — 형식 밖이면 버리고 새로 만든다
    it.each([
      ['a'.repeat(129), '길이 128 초과'],
      ['abc def', '공백'],
      ['id\nX-Injected: 1', '개행(로그·헤더 주입)'],
      ['한글', '비ASCII'],
    ])('반증: x-request-id "%s"(%s)는 무시하고 UUID를 만든다', (incoming) => {
      const req = mockReq({ headers: { [REQUEST_ID_HEADER]: incoming } });
      const { requestId } = ensureRequestTracking(req);
      expect(requestId).not.toBe(incoming);
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('형식 안의 x-request-id(영숫자·._-, 128자 이내)는 그대로 쓴다', () => {
      const incoming = 'trace-1.2_3';
      const req = mockReq({ headers: { [REQUEST_ID_HEADER]: incoming } });
      expect(ensureRequestTracking(req).requestId).toBe(incoming);
    });

    it('응답 헤더에 requestId를 설정한다', () => {
      const req = mockReq();
      const res = mockRes();
      const { requestId } = ensureRequestTracking(req, res);
      expect(res._headers[REQUEST_ID_HEADER]).toBe(requestId);
    });

    it('startTime을 설정한다', () => {
      const req = mockReq();
      const { startTime } = ensureRequestTracking(req);
      expect(typeof startTime).toBe('number');
    });
  });

  describe('calculateDuration', () => {
    it('startTime이 있으면 경과 시간을 반환한다', () => {
      const start = Date.now() - 100;
      const duration = calculateDuration(start);
      expect(duration).toBeGreaterThanOrEqual(99);
    });

    it('startTime이 undefined이면 undefined를 반환한다', () => {
      expect(calculateDuration(undefined)).toBeUndefined();
    });
  });

  describe('setResponseTimeHeader', () => {
    it('duration이 있으면 헤더를 설정한다', () => {
      const res = mockRes();
      setResponseTimeHeader(res, 42);
      expect(res._headers[RESPONSE_TIME_HEADER]).toBe('42');
    });

    it('duration이 undefined이면 설정하지 않는다', () => {
      const res = mockRes();
      setResponseTimeHeader(res, undefined);
      expect(res._headers[RESPONSE_TIME_HEADER]).toBeUndefined();
    });

    it('res가 undefined이면 에러 없이 종료한다', () => {
      expect(() => setResponseTimeHeader(undefined, 10)).not.toThrow();
    });
  });

  describe('buildHttpRequestMeta', () => {
    it('HTTP 요청 메타데이터를 구성한다', () => {
      const req = mockReq();
      const meta = buildHttpRequestMeta(req);
      expect(meta.method).toBe('GET');
      expect(meta.path).toBe('/test');
      expect(meta.clientIp).toBe('127.0.0.1');
    });

    it('OIDC 콜백의 code·state 같은 민감 쿼리 값은 가리고 키는 남긴다', () => {
      const req = mockReq({
        originalUrl:
          '/auth/oidc/google/callback?code=abc&state=xyz&next=%2Fhome',
        query: { code: 'abc', state: 'xyz', next: '/home' },
      });
      const meta = buildHttpRequestMeta(req);
      expect(meta.path).toBe('/auth/oidc/google/callback');
      expect(meta.query).toBe(
        'code=%5Bredacted%5D&state=%5Bredacted%5D&next=%2Fhome',
      );
    });

    it('defaultVersion 옵션을 적용한다', () => {
      const req = mockReq();
      const meta = buildHttpRequestMeta(req, { defaultVersion: '2' });
      expect(meta.version).toBe('2');
    });
  });

  describe('resolveUserId', () => {
    it('user.id가 숫자이면 반환한다', () => {
      expect(resolveUserId(mockReq({ user: { id: 42 } }))).toBe(42);
    });

    it('user.sub가 문자열 숫자이면 변환하여 반환한다', () => {
      expect(resolveUserId(mockReq({ user: { sub: '100' } }))).toBe(100);
    });

    it('user가 없으면 null을 반환한다', () => {
      expect(resolveUserId(mockReq())).toBeNull();
    });

    it('빈 문자열이면 null을 반환한다', () => {
      expect(resolveUserId(mockReq({ user: { id: '  ' } }))).toBeNull();
    });

    it('유효하지 않은 문자열이면 null을 반환한다', () => {
      expect(resolveUserId(mockReq({ user: { id: 'abc' } }))).toBeNull();
    });
  });

  describe('readSingleHeader (배열 헤더 분기)', () => {
    it('배열 헤더에서 첫 유효 값만 사용해 requestId로 반영한다', () => {
      const req = mockReq({
        headers: { [REQUEST_ID_HEADER]: ['', '  ', 'array-id', 'second-id'] },
      });
      const { requestId } = ensureRequestTracking(req);
      expect(requestId).toBe('array-id');
    });

    it('배열 헤더가 모두 공백/빈값이면 새 UUID를 생성한다', () => {
      const req = mockReq({
        headers: { [REQUEST_ID_HEADER]: ['', '   '] },
      });
      const { requestId } = ensureRequestTracking(req);
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('buildHttpRequestMeta 엣지 분기', () => {
    it('originalUrl이 없고 path만 있으면 path를 사용한다', () => {
      const req = mockReq({ originalUrl: undefined, path: '/only-path' });
      const meta = buildHttpRequestMeta(req);
      expect(meta.path).toBe('/only-path');
    });

    it('originalUrl/path가 모두 없으면 빈 문자열로 반환한다', () => {
      const req = mockReq({ originalUrl: undefined, path: undefined });
      const meta = buildHttpRequestMeta(req);
      expect(meta.path).toBe('');
    });
  });

  describe('buildGraphqlRequestMeta path.key 분기', () => {
    function mockInfo(
      overrides: Partial<GraphQLResolveInfo>,
    ): GraphQLResolveInfo {
      return {
        fieldName: 'testField',
        operation: { name: { value: 'TestOp' } },
        parentType: { toString: () => 'Query' },
        path: { key: 'testField' },
        ...overrides,
      } as unknown as GraphQLResolveInfo;
    }

    it('path.key가 문자열이면 그대로 사용한다', () => {
      const req = mockReq();
      const meta = buildGraphqlRequestMeta(mockInfo({}), req);
      expect(meta.path).toBe('testField');
      expect(meta.operationName).toBe('TestOp');
      expect(meta.parentType).toBe('Query');
    });

    it('path.key가 숫자이면 문자열화한다', () => {
      const req = mockReq();
      const info = mockInfo({
        path: { key: 3, prev: undefined, typename: undefined },
      });
      const meta = buildGraphqlRequestMeta(info, req);
      expect(meta.path).toBe('3');
    });

    it('path.key가 잘못된 타입이면 fieldName으로 fallback', () => {
      const req = mockReq();
      const info = mockInfo({
        path: {
          key: undefined as unknown as string,
        } as GraphQLResolveInfo['path'],
      });
      const meta = buildGraphqlRequestMeta(info, req);
      expect(meta.path).toBe('testField');
    });
  });
});
