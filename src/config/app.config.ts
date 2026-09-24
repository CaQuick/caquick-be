import { registerAs } from '@nestjs/config';

export const APP_ROLES = ['api', 'ws', 'worker'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export interface AppConfig {
  role: AppRole;
}

/** 같은 이미지가 역할 플래그로 갈린다(P2 E1). 잘못된 값은 기본값으로 숨기지 않고 부팅에서 던진다. */
export function parseAppRole(raw: string | undefined): AppRole {
  const value = raw?.trim().toLowerCase();
  if (!value) return 'api';
  if ((APP_ROLES as readonly string[]).includes(value)) return value as AppRole;
  throw new Error(
    `APP_ROLE은 ${APP_ROLES.join('|')} 중 하나여야 합니다: ${raw}`,
  );
}

export function resolveAppRole(): AppRole {
  return parseAppRole(process.env.APP_ROLE);
}

/** api·ws: HTTP·GraphQL(subscription 포함)·문서. ws는 지금 api와 같은 구성이고 분리는 라우팅으로 한다. */
export function servesHttpApi(role: AppRole): boolean {
  return role !== 'worker';
}

/** worker만: outbox 디스패처(04에서 릴레이·소비자)·크론. api가 같이 돌리면 같은 작업이 두 번 실행된다. */
export function runsBackgroundJobs(role: AppRole): boolean {
  return role === 'worker';
}

export default registerAs('app', (): AppConfig => ({ role: resolveAppRole() }));
