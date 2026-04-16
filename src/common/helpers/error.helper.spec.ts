import { BadRequestException, HttpException } from '@nestjs/common';

import { resolveMessage, resolveStatus } from '@/common/helpers/error.helper';

describe('error.helper', () => {
  describe('resolveStatus', () => {
    it('HttpException이면 해당 상태 코드를 반환한다', () => {
      expect(resolveStatus(new BadRequestException())).toBe(400);
    });

    it('일반 Error이면 500을 반환한다', () => {
      expect(resolveStatus(new Error('fail'))).toBe(500);
    });

    it('문자열이면 500을 반환한다', () => {
      expect(resolveStatus('unknown')).toBe(500);
    });
  });

  describe('resolveMessage', () => {
    it('HttpException이면 메시지를 반환한다', () => {
      expect(resolveMessage(new HttpException('custom', 403))).toBe('custom');
    });

    it('일반 Error이면 메시지를 반환한다', () => {
      expect(resolveMessage(new Error('oops'))).toBe('oops');
    });

    it('문자열이면 기본 메시지를 반환한다', () => {
      expect(resolveMessage('something')).toBe('Internal Server Error');
    });

    it('null이면 기본 메시지를 반환한다', () => {
      expect(resolveMessage(null)).toBe('Internal Server Error');
    });
  });
});
