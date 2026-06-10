import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerChangePasswordInput } from '@/features/auth/dto/inputs/seller-change-password.input';

function build(plain: object): SellerChangePasswordInput {
  return plainToInstance(SellerChangePasswordInput, plain);
}

describe('SellerChangePasswordInput', () => {
  it('유효 입력 통과', async () => {
    const dto = build({
      currentPassword: 'old!Pass1',
      newPassword: 'New!Pass1',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('currentPassword 길이 8 미만 거절', async () => {
    const dto = build({ currentPassword: 'short', newPassword: 'New!Pass1' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('currentPassword');
  });

  it('newPassword 강 정책 미충족 (특수문자 누락) 거절', async () => {
    const dto = build({
      currentPassword: 'old!Pass1',
      newPassword: 'NoSpecial1',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('newPassword');
  });

  it('newPassword 길이 8 미만 거절', async () => {
    const dto = build({
      currentPassword: 'old!Pass1',
      newPassword: 'Aa1!',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('newPassword');
  });

  it('두 필드 모두 누락 거절', async () => {
    const dto = build({});
    const errors = await validate(dto);
    expect(errors).toHaveLength(2);
  });
});
