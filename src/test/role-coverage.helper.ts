/**
 * 입력 공간을 SDL에서 읽어 온다 — 접두 필드가 생기면 표에 자동으로 줄이 늘고, 그 필드를 처리하는 메서드가
 * RolesGuard + @Roles(role)를 갖추지 않으면 실패한다. roles-coverage spec이 역할별 표로 돌린다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Kind, parse } from 'graphql';

import {
  ROLES_METADATA_KEY,
  RolesGuard,
  type AccountRole,
} from '@/global/auth';

const ROOT_TYPES = new Set(['Query', 'Mutation', 'Subscription']);
const RESOLVER_TYPE_METADATA = 'graphql:resolver_type';
const RESOLVER_NAME_METADATA = 'graphql:resolver_name';
const FEATURES_DIR = join(__dirname, '..', 'features');

export type Ctor = abstract new (...args: never[]) => unknown;

export interface HandlerAuth {
  className: string;
  methodName: string;
  roles: string[] | undefined;
  guards: unknown[];
}

export function collectRootFieldsWithPrefix(
  prefix: string,
  dir: string = FEATURES_DIR,
): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      names.push(...collectRootFieldsWithPrefix(prefix, full));
      continue;
    }
    if (!entry.name.endsWith('.graphql')) continue;
    for (const def of parse(readFileSync(full, 'utf8')).definitions) {
      if (
        (def.kind !== Kind.OBJECT_TYPE_DEFINITION &&
          def.kind !== Kind.OBJECT_TYPE_EXTENSION) ||
        !ROOT_TYPES.has(def.name.value)
      ) {
        continue;
      }
      for (const field of def.fields ?? []) {
        if (field.name.value.startsWith(prefix)) names.push(field.name.value);
      }
    }
  }
  return names.sort();
}

export function collectHandlerAuth(classes: Ctor[]): Map<string, HandlerAuth> {
  const map = new Map<string, HandlerAuth>();
  for (const cls of classes) {
    const classRoles = Reflect.getMetadata(ROLES_METADATA_KEY, cls) as
      string[] | undefined;
    const classGuards =
      (Reflect.getMetadata(GUARDS_METADATA, cls) as unknown[] | undefined) ??
      [];
    for (const methodName of Object.getOwnPropertyNames(cls.prototype)) {
      if (methodName === 'constructor') continue;
      const method = (cls.prototype as Record<string, unknown>)[methodName];
      if (typeof method !== 'function') continue;
      const type = Reflect.getMetadata(RESOLVER_TYPE_METADATA, method) as
        string | undefined;
      if (!type || !ROOT_TYPES.has(type)) continue;
      const fieldName = Reflect.getMetadata(
        RESOLVER_NAME_METADATA,
        method,
      ) as string;
      const methodRoles = Reflect.getMetadata(ROLES_METADATA_KEY, method) as
        string[] | undefined;
      const methodGuards =
        (Reflect.getMetadata(GUARDS_METADATA, method) as
          unknown[] | undefined) ?? [];
      map.set(fieldName, {
        className: cls.name,
        methodName,
        // 메서드 선언이 클래스 선언을 덮어쓴다 — RolesGuard의 getAllAndOverride와 동일
        roles: methodRoles ?? classRoles,
        guards: [...classGuards, ...methodGuards],
      });
    }
  }
  return map;
}

export function violationsOf(
  auth: HandlerAuth | undefined,
  role: AccountRole,
): string[] {
  if (!auth) return ['핸들러 없음'];
  const reasons: string[] = [];
  if (!auth.guards.includes(RolesGuard)) reasons.push('RolesGuard 미적용');
  if (!auth.roles?.includes(role)) reasons.push(`@Roles('${role}') 없음`);
  return reasons;
}

function resolverClassesOf(module: Ctor): Ctor[] {
  const providers =
    (Reflect.getMetadata('providers', module) as unknown[] | undefined) ?? [];
  return providers.filter(
    (p): p is Ctor => typeof p === 'function' && p.name.endsWith('Resolver'),
  );
}

/**
 * src/features 아래 모든 `*.module.ts`를 읽어 Resolver 클래스를 모은다 — 새 feature 모듈이 생기면 자동으로 포함된다.
 * AppModule을 import하지 않는 이유: GraphQL 드라이버 설정의 타입이 ts-jest 해석 아래서 어긋나 suite가 열리지 않는다.
 */
export function collectFeatureResolverClasses(
  dir: string = FEATURES_DIR,
): Ctor[] {
  const out: Ctor[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFeatureResolverClasses(full));
      continue;
    }
    if (!entry.name.endsWith('.module.ts')) continue;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- 파일 목록이 동적이라 정적 import 불가
    const exported = require(full) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (
        typeof value === 'function' &&
        Reflect.hasMetadata('providers', value)
      )
        out.push(...resolverClassesOf(value as Ctor));
    }
  }
  return out;
}
