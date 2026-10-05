import { readExpoPushConfig } from '@/config/expo-push.config';

describe('expoPushConfig', () => {
  it('미설정이면 꺼짐·토큰 없음·타임아웃 5000', () => {
    expect(readExpoPushConfig({})).toEqual({
      enabled: false,
      accessToken: null,
      requestTimeoutMs: 5_000,
    });
  });

  // 전송 스위치 — true/false(대소문자·공백 무시)만 인정하고 나머지는 꺼짐
  it.each([
    ['true', true],
    ['TRUE', true],
    [' true ', true],
    ['false', false],
    ['', false],
    ['yes', false],
    ['1', false],
    ['on', false],
    [undefined, false],
  ])('EXPO_PUSH_ENABLED=%p → %s', (value, expected) => {
    expect(readExpoPushConfig({ EXPO_PUSH_ENABLED: value }).enabled).toBe(
      expected,
    );
  });

  it.each([
    [' tok ', 'tok'],
    ['', null],
    ['   ', null],
    [undefined, null],
  ])('EXPO_PUSH_ACCESS_TOKEN=%p → %p', (value, expected) => {
    expect(
      readExpoPushConfig({ EXPO_PUSH_ACCESS_TOKEN: value }).accessToken,
    ).toBe(expected);
  });

  it.each([
    ['250', 250],
    ['0', 5_000],
    ['-1', 5_000],
    ['abc', 5_000],
    ['', 5_000],
  ])('EXPO_PUSH_TIMEOUT_MS=%p → %s', (value, expected) => {
    expect(
      readExpoPushConfig({ EXPO_PUSH_TIMEOUT_MS: value }).requestTimeoutMs,
    ).toBe(expected);
  });
});
