import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateMyProfileInput } from '@/features/user/dto/inputs/update-my-profile.input';

function build(plain: object): UpdateMyProfileInput {
  return plainToInstance(UpdateMyProfileInput, plain);
}

describe('UpdateMyProfileInput', () => {
  it('빈 입력 통과 (도메인 검증은 서비스 책임)', async () => {
    const dto = build({});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('nickname 단독 수정 허용', async () => {
    const dto = build({ nickname: 'newnick' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('name trim 후 빈 문자열 거절', async () => {
    const dto = build({ name: '   ' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('name');
    expect(errors[0].constraints).toHaveProperty('minLength');
  });

  it('nickname 잘못된 길이 거절', async () => {
    const dto = build({ nickname: 'a' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('nickname');
  });

  it('phoneNumber 형식 오류 거절', async () => {
    const dto = build({ phoneNumber: '02-1234-5678' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('phoneNumber');
  });
});
