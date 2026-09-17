import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminCreateUploadUrlInput } from '@/features/admin/dto/inputs/admin-create-upload-url.input';

function build(plain: object): AdminCreateUploadUrlInput {
  return plainToInstance(AdminCreateUploadUrlInput, plain);
}

describe('AdminCreateUploadUrlInput', () => {
  it.each(['BANNER_IMAGE', 'STORE_IMAGE'])(
    'purpose %s 통과',
    async (purpose) => {
      const dto = build({
        purpose,
        contentType: 'image/png',
        contentLength: 1,
      });
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  // 판매자 전용·미정의 용도는 스키마 단계에서 막히지만 DTO도 같은 집합을 강제한다
  it.each(['PRODUCT_IMAGE', 'PROFILE_IMAGE', 'REVIEW_VIDEO', '', undefined])(
    'purpose %s 거절',
    async (purpose) => {
      const dto = build({
        purpose,
        contentType: 'image/png',
        contentLength: 1,
      });
      const errors = await validate(dto);
      expect(errors[0].property).toBe('purpose');
    },
  );

  it('contentLength 0 거절', async () => {
    const dto = build({
      purpose: 'BANNER_IMAGE',
      contentType: 'image/png',
      contentLength: 0,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('contentLength');
  });
});
