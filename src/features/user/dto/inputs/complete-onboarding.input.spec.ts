import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CompleteOnboardingInput } from '@/features/user/dto/inputs/complete-onboarding.input';

function build(plain: object): CompleteOnboardingInput {
  return plainToInstance(CompleteOnboardingInput, plain);
}

describe('CompleteOnboardingInput', () => {
  it('필수 필드만 (nickname) 허용', async () => {
    const dto = build({ nickname: 'hello1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('전체 필드 + Date birthDate 허용', async () => {
    const dto = build({
      name: '홍길동',
      nickname: 'gildong',
      birthDate: new Date('1990-01-15'),
      phoneNumber: '010-1234-5678',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('nickname 누락 거절', async () => {
    const dto = build({});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'nickname')).toBe(true);
  });

  it('nickname 길이 1자 거절', async () => {
    const dto = build({ nickname: 'a' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('nickname');
    expect(errors[0].constraints).toHaveProperty('isLength');
  });

  it('nickname 허용 외 문자 거절', async () => {
    const dto = build({ nickname: 'hello!' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('nickname');
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('phoneNumber 형식 오류 거절', async () => {
    const dto = build({ nickname: 'gildong', phoneNumber: '01012345678' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('phoneNumber');
  });

  it('birthDate 1900 이전 거절', async () => {
    const dto = build({
      nickname: 'gildong',
      birthDate: new Date('1850-01-01'),
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('birthDate');
  });

  it('birthDate 가 Date 객체가 아니면 거절', async () => {
    const dto = build({ nickname: 'gildong', birthDate: '1990-01-15' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('birthDate');
  });

  it('name 공백만 입력 시 trim 후 빈 문자열로 변환되어 MinLength 미통과는 아니나 MaxLength 통과', async () => {
    // name 은 @IsOptional + @MaxLength 만 있고 @MinLength 없음.
    // trim 후 빈 문자열은 통과 (서비스에서 normalizeName 이 null 변환).
    const dto = build({ nickname: 'gildong', name: '   ' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('name 이 null 이면 통과 (IsOptional 흡수, Transform 은 비-string 경로)', async () => {
    // Transform 콜백은 string 이 아닌 입력을 그대로 통과시켜야 한다.
    // 후속 IsOptional 이 null 을 보고 다른 validator 를 스킵.
    const dto = build({ nickname: 'gildong', name: null });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('name 이 string 도 null 도 아니면 IsString 으로 거절 (Transform 은 통과)', async () => {
    const dto = build({ nickname: 'gildong', name: 12345 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('name');
    expect(errors[0].constraints).toHaveProperty('isString');
  });
});
