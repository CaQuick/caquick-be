import type { Request } from 'express';

import {
  apiVersionOf,
  clientIpOf,
  tryClientIp,
  tryUserAgent,
  userAgentOf,
} from '@/common/utils/http-meta';

function mockReq(
  headers: Record<string, string | string[] | undefined> = {},
  overrides: Partial<Request> = {},
): Request {
  return {
    headers,
    ip: overrides.ip,
    socket: overrides.socket ?? { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
}

describe('http-meta', () => {
  describe('apiVersionOf', () => {
    it('api-version 헤더 문자열을 반환한다', () => {
      expect(apiVersionOf(mockReq({ 'api-version': '2' }))).toBe('2');
    });

    it('배열이면 첫 번째 값을 반환한다', () => {
      expect(apiVersionOf(mockReq({ 'api-version': ['3', '4'] }))).toBe('3');
    });

    it('헤더가 없으면 undefined를 반환한다', () => {
      expect(apiVersionOf(mockReq())).toBeUndefined();
    });
  });

  describe('clientIpOf', () => {
    it('X-Forwarded-For 첫 번째 IP를 반환한다', () => {
      expect(
        clientIpOf(mockReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })),
      ).toBe('1.2.3.4');
    });

    it('X-Forwarded-For가 없으면 X-Real-IP를 반환한다', () => {
      expect(clientIpOf(mockReq({ 'x-real-ip': '10.0.0.1' }))).toBe('10.0.0.1');
    });

    it('둘 다 없으면 req.ip를 반환한다', () => {
      expect(clientIpOf(mockReq({}, { ip: '192.168.0.1' }))).toBe(
        '192.168.0.1',
      );
    });

    it('모두 없으면 socket.remoteAddress를 반환한다', () => {
      expect(clientIpOf(mockReq())).toBe('127.0.0.1');
    });

    it('아무것도 없으면 Unknown IP를 반환한다', () => {
      expect(
        clientIpOf(mockReq({}, { ip: undefined, socket: {} } as never)),
      ).toBe('Unknown IP');
    });
  });

  describe('userAgentOf', () => {
    it('User-Agent 헤더를 파싱하여 반환한다', () => {
      const result = userAgentOf(
        mockReq({
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36',
        }),
      );
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('User-Agent가 없으면 Other 계열 문자열을 반환한다', () => {
      const result = userAgentOf(mockReq());
      expect(typeof result).toBe('string');
    });
  });

  describe('tryClientIp (DB persistence 용 — 추출 실패 시 undefined)', () => {
    it('X-Forwarded-For 첫 번째 IP를 반환한다', () => {
      expect(
        tryClientIp(mockReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })),
      ).toBe('1.2.3.4');
    });

    it('X-Real-IP 를 반환한다', () => {
      expect(tryClientIp(mockReq({ 'x-real-ip': '10.0.0.1' }))).toBe(
        '10.0.0.1',
      );
    });

    it('req.ip 를 반환한다', () => {
      expect(tryClientIp(mockReq({}, { ip: '192.168.0.1' }))).toBe(
        '192.168.0.1',
      );
    });

    it('socket.remoteAddress 를 반환한다', () => {
      expect(tryClientIp(mockReq())).toBe('127.0.0.1');
    });

    it('아무것도 없으면 undefined 를 반환한다 (Unknown IP 문자열 아님)', () => {
      expect(
        tryClientIp(mockReq({}, { ip: undefined, socket: {} } as never)),
      ).toBeUndefined();
    });
  });

  describe('tryUserAgent (DB persistence 용)', () => {
    it('User-Agent 헤더 raw 문자열을 반환한다 (useragent 파싱 X)', () => {
      const raw = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36';
      expect(tryUserAgent(mockReq({ 'user-agent': raw }))).toBe(raw);
    });

    it('헤더가 없으면 undefined 를 반환한다', () => {
      expect(tryUserAgent(mockReq())).toBeUndefined();
    });

    it('512 자에서 자른다', () => {
      const raw = 'a'.repeat(1000);
      const result = tryUserAgent(mockReq({ 'user-agent': raw }));
      expect(result).toHaveLength(512);
    });
  });
});
