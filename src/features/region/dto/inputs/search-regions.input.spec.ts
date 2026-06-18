import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SearchRegionsInput } from '@/features/region/dto/inputs/search-regions.input';

function build(plain: object): SearchRegionsInput {
  return plainToInstance(SearchRegionsInput, plain);
}

describe('SearchRegionsInput', () => {
  it('keyword만 있으면 통과 (limit optional)', async () => {
    expect(await validate(build({ keyword: '강남' }))).toHaveLength(0);
  });

  it('keyword + 유효 limit 통과', async () => {
    expect(await validate(build({ keyword: '강남', limit: 10 }))).toHaveLength(
      0,
    );
  });

  it('keyword 누락 거절', async () => {
    const errors = await validate(build({}));
    expect(errors.some((e) => e.property === 'keyword')).toBe(true);
  });

  it('keyword 빈 문자열 거절 (MinLength 1)', async () => {
    const errors = await validate(build({ keyword: '' }));
    expect(errors[0].property).toBe('keyword');
    expect(errors[0].constraints).toHaveProperty('minLength');
  });

  it('limit 하한(0) 거절', async () => {
    const errors = await validate(build({ keyword: 'a', limit: 0 }));
    expect(errors[0].property).toBe('limit');
  });

  it('limit 상한(51) 거절', async () => {
    const errors = await validate(build({ keyword: 'a', limit: 51 }));
    expect(errors[0].property).toBe('limit');
  });

  it('limit 정수 아님 거절', async () => {
    const errors = await validate(build({ keyword: 'a', limit: 1.5 }));
    expect(errors[0].property).toBe('limit');
  });

  it('keyword 최대 길이 경계(80 통과, 81 거절)', async () => {
    expect(await validate(build({ keyword: 'a'.repeat(80) }))).toHaveLength(0);
    const errors = await validate(build({ keyword: 'a'.repeat(81) }));
    expect(errors[0].property).toBe('keyword');
  });
});
