import type { Request, Response } from 'express';

import {
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
});
