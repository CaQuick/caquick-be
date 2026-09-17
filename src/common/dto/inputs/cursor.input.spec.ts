import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';

function build(plain: object): CursorInput {
  return plainToInstance(CursorInput, plain);
}

describe('CursorInput', () => {
  it.each([
    {},
    { limit: 1 },
    { limit: 100 },
    { cursor: '10' },
    { cursor: 'abc' },
  ])('통과: %o (커서 형식은 서비스의 파서가 검증한다)', async (plain) => {
    expect(await validate(build(plain))).toHaveLength(0);
  });

  it.each([
    ['limit 0', { limit: 0 }, 'limit'],
    ['limit 101', { limit: 101 }, 'limit'],
    ['limit 실수', { limit: 1.5 }, 'limit'],
    ['cursor 숫자형', { cursor: 10 }, 'cursor'],
  ])('거절: %s', async (_label, plain, property) => {
    const errors = await validate(build(plain));
    expect(errors.map((e) => e.property)).toContain(property);
  });
});
