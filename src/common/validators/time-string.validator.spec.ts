import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IsTimeString } from '@/common/validators/time-string.validator';

class Sample {
  @IsTimeString()
  openAt!: string;
}

function build(plain: object): Sample {
  return plainToInstance(Sample, plain);
}

describe('IsTimeString', () => {
  it.each([
    ['00:00', '00:00'],
    ['09:30', '09:30'],
    ['12:00', '12:00'],
    ['23:59', '23:59'],
  ])('허용: %s', async (_label, value) => {
    const dto = build({ openAt: value });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['24:00 (시 경계 초과)', '24:00'],
    ['09:60 (분 경계 초과)', '09:60'],
    ['9:30 (시 1자리)', '9:30'],
    ['09:5 (분 1자리)', '09:5'],
    ['콜론 누락', '0930'],
    ['공백 포함', '09: 30'],
    ['빈 문자열', ''],
  ])('거절: %s', async (_label, value) => {
    const dto = build({ openAt: value });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('openAt');
  });

  it('숫자 타입은 거절한다', async () => {
    const dto = build({ openAt: 930 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });
});
