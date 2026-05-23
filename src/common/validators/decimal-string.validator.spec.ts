import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { IsDecimalString } from '@/common/validators/decimal-string.validator';

class Sample {
  @IsDecimalString()
  price!: string;
}

function build(plain: object): Sample {
  return plainToInstance(Sample, plain);
}

describe('IsDecimalString', () => {
  it.each([
    ['정수 문자열', '1000'],
    ['소수 문자열', '1000.50'],
    ['음수 정수', '-50'],
    ['음수 소수', '-12.345'],
    ['0', '0'],
  ])('허용: %s ("%s")', async (_label, value) => {
    const dto = build({ price: value });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['빈 문자열', ''],
    ['쉼표 포함', '1,000'],
    ['통화 기호', '$100'],
    ['끝 점', '100.'],
    ['앞 점', '.5'],
    ['알파벳 혼재', '1e10'],
    ['공백 포함', ' 100'],
  ])('거절: %s ("%s")', async (_label, value) => {
    const dto = build({ price: value });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('price');
  });

  it('숫자 타입은 거절한다', async () => {
    const dto = build({ price: 1000 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });
});
