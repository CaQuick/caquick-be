import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RegionByLocationInput } from '@/features/region/dto/inputs/region-by-location.input';

async function invalidProperties(plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(RegionByLocationInput, plain));
  return errors.map((e) => e.property);
}

describe('RegionByLocationInput', () => {
  it.each([
    ['서울 시청', 37.5665, 126.978],
    ['위도 하한', -90, 0],
    ['위도 상한', 90, 0],
    ['경도 하한', 0, -180],
    ['경도 상한', 0, 180],
  ])('%s(%p, %p) 통과', async (_label, latitude, longitude) => {
    expect(await invalidProperties({ latitude, longitude })).toEqual([]);
  });

  it.each([
    ['위도 하한 밖', -90.0000001, 0, ['latitude']],
    ['위도 상한 밖', 90.0000001, 0, ['latitude']],
    ['경도 하한 밖', 0, -180.0000001, ['longitude']],
    ['경도 상한 밖', 0, 180.0000001, ['longitude']],
    ['둘 다 밖', 91, 181, ['latitude', 'longitude']],
    ['NaN', Number.NaN, 0, ['latitude']],
    ['Infinity', 0, Number.POSITIVE_INFINITY, ['longitude']],
  ])('%s 거절', async (_label, latitude, longitude, expected) => {
    expect(await invalidProperties({ latitude, longitude })).toEqual(expected);
  });

  it('누락 거절', async () => {
    expect(await invalidProperties({})).toEqual(['latitude', 'longitude']);
  });
});
