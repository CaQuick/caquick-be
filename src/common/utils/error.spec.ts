import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import {
  classifyStatus,
  isValidationException,
  resolveErrorCode,
  resolveMessage,
  resolveStatus,
} from '@/common/utils/error';

const VALIDATION_EXCEPTION = new BadRequestException({
  message: [{ property: 'email', constraints: { isEmail: 'bad' } }],
});

describe('error', () => {
  describe('classifyStatus', () => {
    it.each([
      [400, 'BAD_USER_INPUT'],
      [401, 'UNAUTHENTICATED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [409, 'CONFLICT'],
      [500, 'INTERNAL_SERVER_ERROR'],
      [418, 'INTERNAL_SERVER_ERROR'],
    ])('%i → %s', (status, expected) => {
      expect(classifyStatus(status)).toBe(expected);
    });
  });

  describe('isValidationException', () => {
    it('ValidationPipe 형태({ message: ValidationError[] })만 true', () => {
      expect(isValidationException(VALIDATION_EXCEPTION)).toBe(true);
      expect(isValidationException(new BadRequestException('plain'))).toBe(
        false,
      );
      expect(
        isValidationException(new BadRequestException({ message: ['a'] })),
      ).toBe(false);
      expect(isValidationException(new NotFoundException())).toBe(false);
      expect(isValidationException(new Error('x'))).toBe(false);
    });
  });

  describe('resolveErrorCode', () => {
    it.each([
      [new DomainException('STORE_NOT_FOUND'), 'STORE_NOT_FOUND'],
      [VALIDATION_EXCEPTION, 'VALIDATION_FAILED'],
      [new NotFoundException('x'), 'ROUTE_NOT_FOUND'],
      [new HttpException('teapot', 418), 'INTERNAL_ERROR'],
      [new Error('boom'), 'INTERNAL_ERROR'],
      ['string', 'INTERNAL_ERROR'],
    ])('%p → %s', (exception, expected) => {
      expect(resolveErrorCode(exception)).toBe(expected);
    });
  });

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
    it('ValidationPipe 예외면 카탈로그 VALIDATION_FAILED 문구를 반환한다', () => {
      expect(resolveMessage(VALIDATION_EXCEPTION)).toBe(
        '입력값이 올바르지 않습니다.',
      );
    });

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
