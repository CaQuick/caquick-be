import { Controller, Get, Post, Query, Param, Req, Res } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { AuthService } from '../auth.service';
import { parseOidcProvider } from '../types/oidc-provider.type';

/**
 * 인증 관련 REST 컨트롤러
 *
 * - refresh 토큰은 HttpOnly Cookie, access 토큰은 Bearer로 전달
 */
@ApiTags('Auth')
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
  @ApiOperation({
    summary: 'OIDC 로그인 시작',
    description: '지정한 OIDC provider로 로그인 화면을 시작한다.',
  })
  @ApiParam({
    name: 'provider',
    description: 'OIDC provider',
    enum: ['google', 'kakao'],
  })
  @ApiQuery({
    name: 'returnTo',
    required: false,
    description: '로그인 완료 후 이동할 프론트 경로',
  })
  @ApiFoundResponse({
    description: 'OIDC 인증 페이지로 리다이렉트',
  })
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
  @ApiOperation({
    summary: 'OIDC 콜백 처리',
    description: 'OIDC 인증 결과를 처리하고 access token을 발급한다.',
  })
  @ApiParam({
    name: 'provider',
    description: 'OIDC provider',
    enum: ['google', 'kakao'],
  })
  @ApiOkResponse({
    description: 'OIDC 로그인 결과',
    schema: {
      type: 'object',
      properties: {
        returnTo: { type: 'string', nullable: true },
        accessToken: { type: 'string' },
        tokenType: { type: 'string', example: 'Bearer' },
      },
      required: ['accessToken', 'tokenType'],
    },
  })
  @Get('oidc/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { returnTo, accessToken } = await this.auth.handleOidcCallback(
      provider,
      req,
      res,
    );
    res.status(200).json({ returnTo, accessToken, tokenType: 'Bearer' });
  }

  /**
   * Access/Refresh 재발급 (rotation)
   *
   * POST /auth/refresh
   *
   * @param req Request
   * @param res Response
   */
  @ApiOperation({
    summary: 'Access/Refresh 재발급',
    description: 'Refresh 쿠키를 사용해 access token을 재발급한다.',
  })
  @ApiCookieAuth('refresh-cookie')
  @ApiOkResponse({
    description: '재발급 결과',
    schema: {
      type: 'object',
      properties: {
        accessToken: { type: 'string' },
        tokenType: { type: 'string', example: 'Bearer' },
      },
      required: ['accessToken', 'tokenType'],
    },
  })
  @Post('refresh')
  async refresh(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { accessToken } = await this.auth.refresh(req, res);
    res.status(200).json({ accessToken, tokenType: 'Bearer' });
  }

  /**
   * 로그아웃
   *
   * POST /auth/logout
   *
   * @param req Request
   * @param res Response
   */
  @ApiOperation({
    summary: '로그아웃',
    description: 'Refresh 세션을 폐기하고 쿠키를 제거한다.',
  })
  @ApiCookieAuth('refresh-cookie')
  @ApiNoContentResponse({ description: '로그아웃 완료' })
  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.auth.logout(req, res);
    res.status(204).send();
  }
}
