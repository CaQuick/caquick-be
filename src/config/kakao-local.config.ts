import { registerAs } from '@nestjs/config';

import { parseEnvString } from '@/common/utils/env-parse';

export interface KakaoLocalConfig {
  restApiKey?: string;
}

/**
 * 카카오 앱 하나를 로그인(OIDC)과 로컬 API가 함께 쓴다 — 그 앱의 REST API 키가 곧 OIDC client id라 새 시크릿을 두지 않는다.
 * 없어도 부팅은 막지 않는다(주소 좌표 변환만 GEOCODE_UNAVAILABLE).
 */
export function readKakaoLocalConfig(
  env: NodeJS.ProcessEnv = process.env,
): KakaoLocalConfig {
  return { restApiKey: parseEnvString(env.OIDC_KAKAO_CLIENT_ID) };
}

export default registerAs('kakaoLocal', (): KakaoLocalConfig =>
  readKakaoLocalConfig(),
);
