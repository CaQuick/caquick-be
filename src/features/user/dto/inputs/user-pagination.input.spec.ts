import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UserPaginationInput } from '@/features/user/dto/inputs/user-pagination.input';

function build(plain: object): UserPaginationInput {
  return plainToInstance(UserPaginationInput, plain);
}

describe('UserPaginationInput', () => {
  it('필드 누락 허용 (SDL 기본값 의존)', async () => {
    const dto = build({});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('유효 입력 통과', async () => {
    const dto = build({ offset: 0, limit: 20 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('offset 음수 거절', async () => {
    const dto = build({ offset: -1, limit: 20 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('offset');
  });

  it('limit 0 거절', async () => {
    const dto = build({ offset: 0, limit: 0 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });

  it('limit 51 거절 (운영 상한 50)', async () => {
    const dto = build({ offset: 0, limit: 51 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });

  it('limit 50 경계 허용', async () => {
    const dto = build({ offset: 0, limit: 50 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('정수가 아닌 값 거절', async () => {
    const dto = build({ offset: 1.5, limit: 20 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isInt');
  });
});
