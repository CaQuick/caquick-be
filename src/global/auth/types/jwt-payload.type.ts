/** 서명할 때 우리가 직접 넣는 클레임. iat·exp·iss·aud·kid는 서명 옵션이 붙인다. */
export interface AccessTokenClaims {
  sub: string;

  typ: 'access';

  role: AccountRole;

  /** 자격증명 계정(SELLER/ADMIN)에서만 의미가 있다. */
  mustChangePassword?: boolean;

  /** 판매자만. 매장이 아직 없으면 없다. */
  storeId?: string;
}

/** 검증 후 전략이 받는 payload — 서명 옵션이 채운 시간 클레임이 더해진다. */
export interface AccessTokenPayload extends AccessTokenClaims {
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
