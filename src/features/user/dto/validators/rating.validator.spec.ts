import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IsRatingValid } from '@/features/user/dto/validators/rating.validator';

class Sample {
  @IsRatingValid()
  rating!: number;
}

function build(plain: object): Sample {
  return plainToInstance(Sample, plain);
}

describe('IsRatingValid', () => {
  it.each([
    ['1.0', 1.0],
    ['1.5', 1.5],
    ['3.0', 3.0],
    ['4.5', 4.5],
    ['5.0', 5.0],
  ])('허용: %s', async (_label, value) => {
    const dto = build({ rating: value });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['0.5 미만', 0.5],
    ['5.5 초과', 5.5],
    ['0.3 단위', 1.3],
    ['소수점 4자리', 1.234],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('거절: %s', async (_label, value) => {
    const dto = build({ rating: value });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('rating');
  });

  it('숫자가 아닌 값 거절', async () => {
    const dto = build({ rating: '4.5' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });
});
