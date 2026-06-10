import type { AccountStatus } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * SellerCredentialService 토큰 (Nest DI 주입용).
 */
export const SELLER_CREDENTIAL_SERVICE = Symbol('SELLER_CREDENTIAL_SERVICE');

/**
 * 판매자 자격정보 기반 로그인 / 토큰 회전 / 로그아웃 / 비밀번호 변경 흐름을 담당하는 서비스 인터페이스.
 *
 * 일반 로그인/로그아웃 (OIDC + 일반 refresh) 흐름은 AuthService 가 담당한다.
 */
export interface ISellerCredentialService {
  /**
   * 판매자 username/password 로그인.
   */
  sellerLogin(args: {
    username: string;
    password: string;
    req: Request;
    res: Response;
  }): Promise<{ accessToken: string; accountStatus: AccountStatus }>;

  /**
   * 판매자 refresh 재발급.
   */
  refreshSeller(
    req: Request,
    res: Response,
  ): Promise<{ accessToken: string; accountStatus: AccountStatus }>;

  /**
   * 판매자 로그아웃 (refresh 쿠키 필수, SELLER 타입 검증).
   */
  logoutSeller(req: Request, res: Response): Promise<void>;

  /**
   * 판매자 비밀번호 변경 + 전 세션 revoke + audit log.
   */
  changeSellerPassword(args: {
    accountId: bigint;
    currentPassword: string;
    newPassword: string;
    req: Request;
  }): Promise<void>;
}
