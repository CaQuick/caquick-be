export interface AccessTokenPayload {
  sub: string;

  typ: 'access';

  iat: number;

  exp: number;
}

export interface JwtUser {
  accountId: string;
  accountType?: AccountRole;
  /** 자격증명 계정(SELLER/ADMIN)에서만 true일 수 있다. */
  mustChangePassword?: boolean;
}

/** Prisma AccountType과 값이 같다 — global은 prisma에 의존하지 않는다. */
export type AccountRole = 'USER' | 'SELLER' | 'ADMIN';
