import { registerAs } from '@nestjs/config';

import { parseEnvString } from '@/common/utils/env-parse';

export interface AdminWebConfig {
  /** 관리자 웹 주소(끝 슬래시 없음). 있으면 업무 알림에 처리 화면 링크를 붙인다. */
  baseUrl: string | null;
}

/** 선택 설정. 값이 있는데 쿼리·해시 없는 http(s) 주소가 아니면 부팅을 막는다 — 깨진 링크가 알림마다 나가지 않게. */
export function readAdminWebConfig(
  env: NodeJS.ProcessEnv = process.env,
): AdminWebConfig {
  const raw = parseEnvString(env.ADMIN_WEB_BASE_URL);
  if (!raw) return { baseUrl: null };
  const url = URL.parse(raw);
  if (
    !url ||
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `ADMIN_WEB_BASE_URL은 쿼리·해시 없는 http(s) 주소여야 합니다: ${raw}`,
    );
  }
  return { baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, '') };
}

export default registerAs('adminWeb', (): AdminWebConfig =>
  readAdminWebConfig(),
);
