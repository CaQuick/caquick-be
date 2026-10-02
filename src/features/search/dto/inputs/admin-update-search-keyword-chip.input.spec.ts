import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminUpdateSearchKeywordChipInput } from '@/features/search/dto/inputs/admin-update-search-keyword-chip.input';

function build(plain: object): AdminUpdateSearchKeywordChipInput {
  return plainToInstance(AdminUpdateSearchKeywordChipInput, plain);
}

describe('AdminUpdateSearchKeywordChipInput', () => {
  it('chipId만 있는 부분 수정 통과', async () => {
    expect(await validate(build({ chipId: '1' }))).toHaveLength(0);
  });

  // non-null 컬럼은 명시적 null을 거절한다(서비스 정규화·Prisma 위반 방지)
  it.each(['keyword', 'isActive'])('%s: null 거절', async (field) => {
    const errors = await validate(build({ chipId: '1', [field]: null }));
    expect(errors.map((e) => e.property)).toEqual([field]);
  });

  // 기간은 null이 "제한 없앰"이다
  it.each(['startsAt', 'endsAt'])('%s: null 허용', async (field) => {
    expect(await validate(build({ chipId: '1', [field]: null }))).toHaveLength(
      0,
    );
  });

  it('타입이 맞지 않으면 거절한다', async () => {
    const errors = await validate(
      build({
        chipId: '1',
        keyword: 1,
        isActive: 'yes',
        startsAt: '2026-12-01',
        endsAt: 0,
      }),
    );
    expect(errors.map((e) => e.property).sort()).toEqual([
      'endsAt',
      'isActive',
      'keyword',
      'startsAt',
    ]);
  });
});
