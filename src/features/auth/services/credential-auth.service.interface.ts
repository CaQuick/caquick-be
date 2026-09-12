import type { AccountStatus } from '@prisma/client';
import type { Request, Response } from 'express';

import type { AccountRole } from '@/global/auth';

/**
 * CredentialAuthService 토큰 (Nest DI 주입용).
 */
export const CREDENTIAL_AUTH_SERVICE = Symbol('CREDENTIAL_AUTH_SERVICE');

/** username/password 자격증명을 쓰는 계정 타입. USER는 OIDC만 쓴다. */
export type CredentialRole = Exclude<AccountRole, 'USER'>;

export interface CredentialLoginResult {
  accessToken: string;
  accountStatus: AccountStatus;
  /** 관리자가 지정한 초기/초기화 비밀번호 상태. true면 변경 전까지 다른 API가 거부된다. */
  mustChangePassword: boolean;
}

/**
 * username/password 자격증명 기반 로그인 / 토큰 회전 / 로그아웃 / 비밀번호 변경 서비스.
 * SELLER·ADMIN이 공유하며 role 인자로 계정 타입을 고정한다 — 판매자 자격증명으로
 * 관리자 엔드포인트에 로그인하는 것을 막는다.
 *
 * 일반 로그인/로그아웃 (OIDC + 일반 refresh) 흐름은 AuthService 가 담당한다.
 */
export interface ICredentialAuthService {
  login(args: {
    role: CredentialRole;
    username: string;
    password: string;
    req: Request;
    res: Response;
  }): Promise<CredentialLoginResult>;

  refresh(args: {
    role: CredentialRole;
    req: Request;
    res: Response;
  }): Promise<CredentialLoginResult>;

  /** refresh 쿠키 필수, role 타입 검증. */
  logout(args: {
    role: CredentialRole;
    req: Request;
    res: Response;
  }): Promise<void>;

  /** 비밀번호 변경 + 전 세션 revoke + audit log. must_change_password 해제. */
  changePassword(args: {
    role: CredentialRole;
    accountId: bigint;
    currentPassword: string;
    newPassword: string;
    req: Request;
  }): Promise<void>;
}
