import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PaginationInput } from '@/common/dto/pagination.input';

function build(plain: object): PaginationInput {
  return plainToInstance(PaginationInput, plain);
}

describe('PaginationInput', () => {
  it('유효한 입력은 에러 없음', async () => {
    const dto = build({ offset: 0, limit: 20 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('offset 음수는 거절한다', async () => {
    const dto = build({ offset: -1, limit: 20 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('offset');
    expect(errors[0].constraints).toHaveProperty('min');
  });

  it('limit 0은 거절한다', async () => {
    const dto = build({ offset: 0, limit: 0 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });

  it('limit 101은 거절한다', async () => {
    const dto = build({ offset: 0, limit: 101 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
    expect(errors[0].constraints).toHaveProperty('max');
  });

  it('offset · limit 동시 위반 시 두 에러 모두 보고한다', async () => {
    const dto = build({ offset: -5, limit: 200 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(2);
    const properties = errors.map((e) => e.property).sort();
    expect(properties).toEqual(['limit', 'offset']);
  });

  it('정수가 아닌 값은 거절한다', async () => {
    const dto = build({ offset: 1.5, limit: 20 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isInt');
  });
});
