import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReportReviewInput } from '@/features/user/dto/inputs/report-review.input';

function build(plain: object): ReportReviewInput {
  return plainToInstance(ReportReviewInput, plain);
}

describe('ReportReviewInput', () => {
  it('유효 입력 통과(detail 생략·null 허용)', async () => {
    expect(
      await validate(build({ reviewId: '1', reason: 'SPAM' })),
    ).toHaveLength(0);
    expect(
      await validate(build({ reviewId: '1', reason: 'OTHER', detail: null })),
    ).toHaveLength(0);
  });

  it.each(['SCAM', '', null])('reason %p 거절', async (reason) => {
    const errors = await validate(build({ reviewId: '1', reason }));
    expect(errors.map((e) => e.property)).toEqual(['reason']);
  });

  it('detail 500자 초과 거절', async () => {
    const errors = await validate(
      build({ reviewId: '1', reason: 'SPAM', detail: 'd'.repeat(501) }),
    );
    expect(errors.map((e) => e.property)).toEqual(['detail']);
  });
});
