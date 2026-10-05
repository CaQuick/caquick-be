import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerRegisterPushTokenInput } from '@/features/notification/dto/inputs/seller-register-push-token.input';
import { SellerUnregisterPushTokenInput } from '@/features/notification/dto/inputs/seller-unregister-push-token.input';

const VALID = { token: 'ExponentPushToken[abc-123]', platform: 'IOS' };

async function propertiesOf(plain: object): Promise<string[]> {
  const errors = await validate(
    plainToInstance(SellerRegisterPushTokenInput, plain),
  );
  return errors.map((e) => e.property);
}

describe('SellerRegisterPushTokenInput', () => {
  it.each([
    ['ExponentPushToken[abc-123]', true],
    ['ExpoPushToken[x]', true],
    ['ExpoPushToken[a_B-9]', true],
    ['abc', false],
    ['', false],
    ['ExponentPushToken[]', false],
    ['ExponentPushToken[abc 123]', false],
    [' ExponentPushToken[abc]', false],
    ['ExponentPushToken[abc]\n', false],
    ['expopushtoken[abc]', false],
    [`ExpoPushToken[${'a'.repeat(185)}]`, true],
    [`ExpoPushToken[${'a'.repeat(186)}]`, false],
  ])('token %p → 통과 %s', async (token, ok) => {
    expect(await propertiesOf({ ...VALID, token })).toEqual(
      ok ? [] : ['token'],
    );
  });

  it.each([
    ['IOS', true],
    ['ANDROID', true],
    ['WEB', false],
    ['ios', false],
    [undefined, false],
  ])('platform %p → 통과 %s', async (platform, ok) => {
    expect(await propertiesOf({ ...VALID, platform })).toEqual(
      ok ? [] : ['platform'],
    );
  });

  it.each([
    [undefined, true],
    [null, true],
    ['device-1', true],
    ['a'.repeat(128), true],
    ['a'.repeat(129), false],
    [123, false],
  ])('deviceId %p → 통과 %s', async (deviceId, ok) => {
    expect(await propertiesOf({ ...VALID, deviceId })).toEqual(
      ok ? [] : ['deviceId'],
    );
  });
});

describe('SellerUnregisterPushTokenInput', () => {
  it.each([
    ['ExponentPushToken[abc]', true],
    ['anything', true],
    ['a'.repeat(201), false],
    [undefined, false],
  ])('token %p → 통과 %s', async (token, ok) => {
    const errors = await validate(
      plainToInstance(SellerUnregisterPushTokenInput, { token }),
    );
    expect(errors.map((e) => e.property)).toEqual(ok ? [] : ['token']);
  });
});
