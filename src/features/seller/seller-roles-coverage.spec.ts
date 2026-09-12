/**
 * 판매자 루트 필드 전수 × 인가 선언 대조.
 *
 * "현재 리졸버가 전부 @Roles('SELLER')를 달고 있다"는 사실은 새 seller* 필드가
 * 가드 없이 추가되는 걸 막지 못한다. 그래서 입력 공간을 SDL에서 읽어 온다 —
 * seller 접두 루트 필드가 생기면 이 표에 자동으로 줄이 늘고, 그 필드를 처리하는
 * 메서드가 RolesGuard + @Roles('SELLER')를 갖추지 않으면 실패한다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Query } from '@nestjs/graphql';
import { Kind, parse } from 'graphql';

import { ConversationSubscriptionResolver } from '@/features/conversation/resolvers/conversation-subscription.resolver';
import { SellerModule } from '@/features/seller/seller.module';
import { ROLES_METADATA_KEY, RolesGuard } from '@/global/auth';

const ROOT_TYPES = new Set(['Query', 'Mutation', 'Subscription']);
const RESOLVER_TYPE_METADATA = 'graphql:resolver_type';
const RESOLVER_NAME_METADATA = 'graphql:resolver_name';

type Ctor = abstract new (...args: never[]) => unknown;

interface HandlerAuth {
  className: string;
  methodName: string;
  roles: string[] | undefined;
  guards: unknown[];
}

/** src/features 아래 SDL에서 seller 접두 루트 필드 이름을 모은다. */
function collectSellerRootFields(dir: string): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      names.push(...collectSellerRootFields(full));
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
        if (field.name.value.startsWith('seller')) names.push(field.name.value);
      }
    }
  }
  return names.sort();
}

/** 리졸버 클래스들의 루트 핸들러를 필드 이름 → 인가 선언으로 매핑한다. */
function collectHandlerAuth(classes: Ctor[]): Map<string, HandlerAuth> {
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

/** 필드마다 위반 사유를 돌려준다. 빈 배열이면 통과. */
function violationsOf(
  fieldName: string,
  auth: HandlerAuth | undefined,
): string[] {
  if (!auth) return ['핸들러 없음'];
  const reasons: string[] = [];
  if (!auth.guards.includes(RolesGuard)) reasons.push('RolesGuard 미적용');
  if (!auth.roles?.includes('SELLER')) reasons.push("@Roles('SELLER') 없음");
  return reasons;
}

function resolverClassesOf(module: Ctor): Ctor[] {
  const providers = Reflect.getMetadata('providers', module) as unknown[];
  return providers.filter(
    (p): p is Ctor => typeof p === 'function' && p.name.endsWith('Resolver'),
  );
}

describe('seller 루트 필드 인가 커버리지', () => {
  const sellerFields = collectSellerRootFields(join(__dirname, '..'));
  const handlerAuth = collectHandlerAuth([
    ...resolverClassesOf(SellerModule),
    ConversationSubscriptionResolver,
  ]);

  it('SDL에서 seller 접두 루트 필드를 읽어 왔다(입력 공간이 비어 있지 않다)', () => {
    expect(sellerFields.length).toBeGreaterThan(30);
  });

  it.each(sellerFields)(
    '%s 핸들러는 RolesGuard + @Roles(SELLER)를 갖춘다',
    (fieldName) => {
      expect(violationsOf(fieldName, handlerAuth.get(fieldName))).toEqual([]);
    },
  );

  describe('검출기 반증', () => {
    it('가드 없는 핸들러는 두 사유 모두로 걸린다', () => {
      class UnguardedResolver {
        @Query('sellerUnguarded')
        sellerUnguarded(): string {
          return '';
        }
      }
      const auth = collectHandlerAuth([UnguardedResolver]).get(
        'sellerUnguarded',
      );
      expect(violationsOf('sellerUnguarded', auth)).toEqual([
        'RolesGuard 미적용',
        "@Roles('SELLER') 없음",
      ]);
    });

    it('핸들러 자체가 없으면 걸린다', () => {
      expect(violationsOf('sellerMissing', undefined)).toEqual(['핸들러 없음']);
    });
  });
});
