// ── 판매자 푸시 디바이스 ──

/** Expo 푸시 토큰 형식. 구형 `ExponentPushToken[...]`과 신형 `ExpoPushToken[...]` 둘 다 받는다. */
export const EXPO_PUSH_TOKEN_PATTERN =
  /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
export const MAX_PUSH_TOKEN_LENGTH = 200;
export const MAX_PUSH_DEVICE_ID_LENGTH = 128;

export const PUSH_PLATFORMS = ['IOS', 'ANDROID'] as const;
export type PushPlatformValue = (typeof PUSH_PLATFORMS)[number];

/** `SellerPushDevice.disabled_reason` 값. */
export const PUSH_DEVICE_DISABLED_REASON = {
  UNREGISTERED: 'UNREGISTERED',
  DEVICE_NOT_REGISTERED: 'DEVICE_NOT_REGISTERED',
} as const;
export type PushDeviceDisabledReason =
  (typeof PUSH_DEVICE_DISABLED_REASON)[keyof typeof PUSH_DEVICE_DISABLED_REASON];
