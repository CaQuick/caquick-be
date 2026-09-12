import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Roles } from '@/global/auth/decorators/roles.decorator';
import { RolesGuard } from '@/global/auth/guards/roles.guard';
import type { AccountRole } from '@/global/auth/types/jwt-payload.type';

/** GraphQL 컨텍스트: args[2]가 context, req.user가 인증 결과. */
function makeGqlContext(args: {
  handler: object;
  cls: object;
  user?: { accountId: string; accountType?: AccountRole };
}): ExecutionContext {
  const gqlArgs = [undefined, {}, { req: { user: args.user } }, {}];
  return {
    getType: () => 'graphql',
    getArgs: () => gqlArgs,
    getArgByIndex: (i: number) => gqlArgs[i],
    switchToHttp: () => ({ getRequest: () => gqlArgs[0] }),
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
    getHandler: () => args.handler,
    getClass: () => args.cls,
  } as unknown as ExecutionContext;
}

function makeHttpContext(args: {
  handler: object;
  cls: object;
  user?: { accountId: string; accountType?: AccountRole };
}): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user: args.user }) }),
    getHandler: () => args.handler,
    getClass: () => args.cls,
  } as unknown as ExecutionContext;
}

@Roles('SELLER')
class SellerOnlyResolver {
  handler(): void {}

  @Roles('USER')
  userOverride(): void {}
}

class NoRolesResolver {
  handler(): void {}
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('@Roles 선언이 없으면 통과한다', () => {
    const ctx = makeGqlContext({
      handler: NoRolesResolver.prototype.handler,
      cls: NoRolesResolver,
      user: { accountId: '1', accountType: 'USER' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('클래스 @Roles와 일치하면 통과한다', () => {
    const ctx = makeGqlContext({
      handler: SellerOnlyResolver.prototype.handler,
      cls: SellerOnlyResolver,
      user: { accountId: '1', accountType: 'SELLER' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it.each<AccountRole>(['USER', 'ADMIN'])(
    '허용되지 않은 계정 타입(%s)은 FORBIDDEN',
    (accountType) => {
      const ctx = makeGqlContext({
        handler: SellerOnlyResolver.prototype.handler,
        cls: SellerOnlyResolver,
        user: { accountId: '1', accountType },
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    },
  );

  it('accountType이 비어 있으면 FORBIDDEN', () => {
    const ctx = makeGqlContext({
      handler: SellerOnlyResolver.prototype.handler,
      cls: SellerOnlyResolver,
      user: { accountId: '1' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('req.user가 없으면 UNAUTHENTICATED', () => {
    const ctx = makeGqlContext({
      handler: SellerOnlyResolver.prototype.handler,
      cls: SellerOnlyResolver,
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('메서드 @Roles가 클래스 선언을 덮어쓴다', () => {
    const asUser = makeGqlContext({
      handler: SellerOnlyResolver.prototype.userOverride,
      cls: SellerOnlyResolver,
      user: { accountId: '1', accountType: 'USER' },
    });
    expect(guard.canActivate(asUser)).toBe(true);

    const asSeller = makeGqlContext({
      handler: SellerOnlyResolver.prototype.userOverride,
      cls: SellerOnlyResolver,
      user: { accountId: '1', accountType: 'SELLER' },
    });
    expect(() => guard.canActivate(asSeller)).toThrow(ForbiddenException);
  });

  it('HTTP 컨텍스트에서도 req.user로 판정한다', () => {
    const ok = makeHttpContext({
      handler: SellerOnlyResolver.prototype.handler,
      cls: SellerOnlyResolver,
      user: { accountId: '1', accountType: 'SELLER' },
    });
    expect(guard.canActivate(ok)).toBe(true);

    const denied = makeHttpContext({
      handler: SellerOnlyResolver.prototype.handler,
      cls: SellerOnlyResolver,
      user: { accountId: '1', accountType: 'USER' },
    });
    expect(() => guard.canActivate(denied)).toThrow(ForbiddenException);
  });
});
