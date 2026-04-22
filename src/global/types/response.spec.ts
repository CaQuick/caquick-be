import { HttpStatus } from '@nestjs/common';

import { ApiResponseTemplate } from '@/global/types/response';

describe('ApiResponseTemplate', () => {
  describe('SUCCESS', () => {
    it('message가 success, code가 200, data가 null이다', () => {
      const res = ApiResponseTemplate.SUCCESS();
      expect(res.message).toBe('success');
      expect(res.code).toBe(HttpStatus.OK);
      expect(res.data).toBeNull();
    });
  });

  describe('SUCCESS_WITH_DATA', () => {
    it('data를 포함한 성공 응답을 생성한다', () => {
      const res = ApiResponseTemplate.SUCCESS_WITH_DATA({ id: 1 });
      expect(res.message).toBe('success');
      expect(res.code).toBe(HttpStatus.OK);
      expect(res.data).toEqual({ id: 1 });
    });

    it('커스텀 message와 status를 지정할 수 있다', () => {
      const res = ApiResponseTemplate.SUCCESS_WITH_DATA(
        null,
        'created',
        HttpStatus.CREATED,
      );
      expect(res.message).toBe('created');
      expect(res.code).toBe(HttpStatus.CREATED);
    });
  });

  describe('ERROR', () => {
    it('기본값으로 error, 500을 생성한다', () => {
      const res = ApiResponseTemplate.ERROR();
      expect(res.message).toBe('error');
      expect(res.code).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(res.data).toBeNull();
    });

    it('커스텀 message와 status를 지정할 수 있다', () => {
      const res = ApiResponseTemplate.ERROR('Not Found', HttpStatus.NOT_FOUND);
      expect(res.message).toBe('Not Found');
      expect(res.code).toBe(404);
    });
  });

  describe('ERROR_WITH_DATA', () => {
    it('data를 포함한 에러 응답을 생성한다', () => {
      const errors = [{ field: 'email', msg: 'invalid' }];
      const res = ApiResponseTemplate.ERROR_WITH_DATA(
        errors,
        'Validation Error',
        HttpStatus.BAD_REQUEST,
      );
      expect(res.message).toBe('Validation Error');
      expect(res.code).toBe(400);
      expect(res.data).toEqual(errors);
    });

    it('message/status 기본값: "error", 500', () => {
      const res = ApiResponseTemplate.ERROR_WITH_DATA({ x: 1 });
      expect(res.message).toBe('error');
      expect(res.code).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(res.data).toEqual({ x: 1 });
    });

    it('message만 지정 + status 기본값', () => {
      const res = ApiResponseTemplate.ERROR_WITH_DATA({ x: 1 }, 'custom error');
      expect(res.message).toBe('custom error');
      expect(res.code).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('SUCCESS_WITH_DATA (default 파라미터 커버)', () => {
    it('message만 지정 + status 기본값(200)', () => {
      const res = ApiResponseTemplate.SUCCESS_WITH_DATA({ id: 1 }, 'created');
      expect(res.message).toBe('created');
      expect(res.code).toBe(HttpStatus.OK);
    });
  });
});
