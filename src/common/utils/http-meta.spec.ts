import type { Request } from 'express';

import {
  apiVersionOf,
  clientIpOf,
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
});
