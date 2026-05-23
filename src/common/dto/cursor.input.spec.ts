import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CursorInput } from '@/common/dto/cursor.input';

function build(plain: object): CursorInput {
  return plainToInstance(CursorInput, plain);
}

describe('CursorInput', () => {
  it('cursor 생략은 허용한다', async () => {
    const dto = build({ limit: 20 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('cursor 문자열은 허용한다', async () => {
    const dto = build({ cursor: 'abc123', limit: 20 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('cursor 가 문자열이 아니면 거절한다', async () => {
    const dto = build({ cursor: 123, limit: 20 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('cursor');
    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('limit 0은 거절한다', async () => {
    const dto = build({ limit: 0 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });

  it('limit 101은 거절한다', async () => {
    const dto = build({ limit: 101 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });
});
