import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateMyProfileImageInput } from '@/features/user/dto/inputs/update-my-profile-image.input';

function build(plain: object): UpdateMyProfileImageInput {
  return plainToInstance(UpdateMyProfileImageInput, plain);
}

describe('UpdateMyProfileImageInput', () => {
  it('정상 URL 허용', async () => {
    const dto = build({
      profileImageUrl: 'https://cdn.caquick.site/u/1/profile.jpg',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('빈 문자열 거절', async () => {
    const dto = build({ profileImageUrl: '' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('profileImageUrl');
    expect(errors[0].constraints).toHaveProperty('minLength');
  });

  it('공백만 입력 시 trim 후 빈 문자열로 거절', async () => {
    const dto = build({ profileImageUrl: '   ' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('profileImageUrl');
  });

  it('2048 초과 거절', async () => {
    const dto = build({ profileImageUrl: 'https://x/' + 'a'.repeat(2050) });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('profileImageUrl');
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('누락 거절', async () => {
    const dto = build({});
    const errors = await validate(dto);
    expect(errors[0].property).toBe('profileImageUrl');
  });

  it('null 입력 시 IsString 으로 거절 (Transform 은 비-string 경로 통과)', async () => {
    // Transform 콜백은 string 이 아닌 값을 그대로 통과시킨다. 검증은 IsString 이 담당.
    const dto = build({ profileImageUrl: null });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('profileImageUrl');
    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('숫자 입력 시 IsString 으로 거절', async () => {
    const dto = build({ profileImageUrl: 12345 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('profileImageUrl');
    expect(errors[0].constraints).toHaveProperty('isString');
  });
});
