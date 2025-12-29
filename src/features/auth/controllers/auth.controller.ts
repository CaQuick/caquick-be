import { Controller, Get, Post, Query, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService } from '../auth.service';
import { parseOidcProvider } from '../types/oidc-provider.type';

/**
 * 인증 관련 REST 컨트롤러
 *
 * - 토큰은 HttpOnly Cookie로만 전달
 */
@Controller('auth')
export class AuthController {
  /**
   * @param auth AuthService
   */
  constructor(private readonly auth: AuthService) {}

  /**
   * OIDC 로그인 시작
   *
   * GET /auth/oidc/:provider/start?returnTo=...
   *
   * @param provider provider
   * @param returnTo return url
   * @param res Response
   */
  @Get('oidc/:provider/start')
  async start(
    @Param('provider') provider: string,
    @Query('returnTo') returnTo: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // provider 검증(잘못된 값이면 즉시 에러)
    parseOidcProvider(provider);

    const { redirectUrl } = await this.auth.startOidcLogin(
      provider,
      returnTo,
      res,
    );
    res.redirect(redirectUrl);
  }

  /**
   * OIDC 콜백
   *
   * GET /auth/oidc/:provider/callback?code=...&state=...
   *
   * @param provider provider
   * @param req Request
   * @param res Response
   */
  @Get('oidc/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { returnTo } = await this.auth.handleOidcCallback(provider, req, res);
    res.redirect(returnTo);
  }

  /**
   * Access/Refresh 재발급 (rotation)
   *
   * POST /auth/refresh
   *
   * @param req Request
   * @param res Response
   */
  @Post('refresh')
  async refresh(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.auth.refresh(req, res);
    res.status(204).send();
  }

  /**
   * 로그아웃
   *
   * POST /auth/logout
   *
   * @param req Request
   * @param res Response
   */
  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.auth.logout(req, res);
    res.status(204).send();
  }
}
