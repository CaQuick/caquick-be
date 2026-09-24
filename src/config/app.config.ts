import { registerAs } from '@nestjs/config';

import { normalizeRoutePath } from '@/common/utils/route-path';

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

/** 라벨 전용(로거 defaultMeta 등) — 검증하지 않는다. 잘못된 값은 main.ts의 resolveAppRole()이 bootstrap 안에서 던져 부팅 경보를 탄다. */
export function appRoleLabel(): string {
  return process.env.APP_ROLE?.trim().toLowerCase() || 'api';
}

/** AppModule.forRole(role)이 받은 역할을 모듈 안에 봉인하는 토큰 — configure()가 env를 다시 읽어 imports 배선과 어긋나지 않게. */
export const APP_ROLE_TOKEN = Symbol('APP_ROLE');

/** api·ws: HTTP·GraphQL(subscription 포함)·문서. ws는 지금 api와 같은 구성이고 분리는 라우팅으로 한다. */
export function servesHttpApi(role: AppRole): boolean {
  return role !== 'worker';
}

/** worker만: outbox 디스패처(04에서 릴레이·소비자)·크론. api가 같이 돌리면 같은 작업이 두 번 실행된다. */
export function runsBackgroundJobs(role: AppRole): boolean {
  return role === 'worker';
}

/**
 * worker 리스너가 여는 경로. 컨트롤러는 feature 모듈에 묶여 있어 역할로 모듈을 빼는 대신 리스너 단에서 막는다 —
 * 새 컨트롤러가 생겨도 worker에는 자동으로 닫힌다. `/metrics`는 05에서 쓴다.
 */
export const WORKER_ROUTE_PREFIXES: readonly string[] = ['/health', '/metrics'];

export function isWorkerRouteAllowed(path: string): boolean {
  const normalized = normalizeRoutePath(path);
  return WORKER_ROUTE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export default registerAs('app', (): AppConfig => ({ role: resolveAppRole() }));
