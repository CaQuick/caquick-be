import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerDashboardInput } from '@/features/dashboard/dto/inputs/seller-dashboard.input';

function build(plain: object): SellerDashboardInput {
  return plainToInstance(SellerDashboardInput, plain);
}

describe('SellerDashboardInput', () => {
  it.each([
    ['생략', {}],
    ['null', { date: null }],
    ['문자열', { date: '2026-10-05' }],
    // 형식·존재 여부는 service가 INVALID_DATE로 판정한다
    ['빈 문자열', { date: '' }],
    ['형식 밖 문자열', { date: '2026-1-5' }],
  ])('date %s 통과', async (_label, plain) => {
    expect(await validate(build(plain))).toHaveLength(0);
  });

  it('date 문자열 아님 거절', async () => {
    const errors = await validate(build({ date: 20261005 }));
    expect(errors.map((e) => e.property)).toEqual(['date']);
  });
});
