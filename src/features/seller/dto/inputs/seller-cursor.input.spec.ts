import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';

function build(plain: object): SellerCursorInput {
  return plainToInstance(SellerCursorInput, plain);
}

describe('SellerCursorInput', () => {
  it('필드 누락 허용 (SDL 기본값 의존)', async () => {
    const dto = build({});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('유효 입력 통과', async () => {
    const dto = build({ limit: 20, cursor: 'c1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('limit 0 거절', async () => {
    const dto = build({ limit: 0 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('limit');
  });

  it('limit 101 거절 (상한 100)', async () => {
    const dto = build({ limit: 101 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('limit');
  });

  it('limit 100 경계 허용', async () => {
    const dto = build({ limit: 100 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('cursor 가 문자열이 아니면 거절', async () => {
    const dto = build({ cursor: 123 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('cursor');
  });
});
