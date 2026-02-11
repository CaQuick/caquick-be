import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
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
    description:
      'OIDC 인증 결과를 처리하고 세션 쿠키를 발급한 뒤 리다이렉트한다.',
  })
  @ApiParam({
    name: 'provider',
    description: 'OIDC provider',
    enum: ['google', 'kakao'],
  })
  @ApiFoundResponse({
    description: '로그인 완료 후 returnTo로 리다이렉트',
  })
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

  /**
   * 판매자 로그인
   *
   * POST /auth/seller/login
   */
  @ApiOperation({
    summary: '판매자 로그인',
    description: '판매자 username/password로 로그인한다.',
  })
  @ApiOkResponse({
    description: '판매자 로그인 결과',
    schema: {
      type: 'object',
      properties: {
        accessToken: { type: 'string' },
        tokenType: { type: 'string', example: 'Bearer' },
        accountStatus: {
          type: 'string',
          enum: ['PENDING', 'ACTIVE', 'SUSPENDED'],
        },
      },
      required: ['accessToken', 'tokenType', 'accountStatus'],
    },
  })
  @Post('seller/login')
  async sellerLogin(
    @Body() body: SellerLoginBody,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { accessToken, accountStatus } = await this.auth.sellerLogin({
      username: body.username,
      password: body.password,
      req,
      res,
    });
    res.status(200).json({
      accessToken,
      tokenType: 'Bearer',
      accountStatus,
    });
  }

  /**
   * 판매자 refresh 재발급
   *
   * POST /auth/seller/refresh
   */
  @ApiOperation({
    summary: '판매자 Access/Refresh 재발급',
    description: '판매자 refresh 쿠키를 사용해 access token을 재발급한다.',
  })
  @ApiCookieAuth('refresh-cookie')
  @ApiOkResponse({
    description: '판매자 재발급 결과',
    schema: {
      type: 'object',
      properties: {
        accessToken: { type: 'string' },
        tokenType: { type: 'string', example: 'Bearer' },
        accountStatus: {
          type: 'string',
          enum: ['PENDING', 'ACTIVE', 'SUSPENDED'],
        },
      },
      required: ['accessToken', 'tokenType', 'accountStatus'],
    },
  })
  @Post('seller/refresh')
  async sellerRefresh(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { accessToken, accountStatus } = await this.auth.refreshSeller(
      req,
      res,
    );
    res.status(200).json({
      accessToken,
      tokenType: 'Bearer',
      accountStatus,
    });
  }

  /**
   * 판매자 로그아웃
   *
   * POST /auth/seller/logout
   */
  @ApiOperation({
    summary: '판매자 로그아웃',
    description: '판매자 refresh 세션을 폐기하고 쿠키를 제거한다.',
  })
  @ApiCookieAuth('refresh-cookie')
  @ApiNoContentResponse({ description: '판매자 로그아웃 완료' })
  @Post('seller/logout')
  async sellerLogout(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.auth.logoutSeller(req, res);
    res.status(204).send();
  }

  /**
   * 판매자 비밀번호 변경
   *
   * POST /auth/seller/change-password
   */
  @ApiOperation({
    summary: '판매자 비밀번호 변경',
    description: '현재 비밀번호를 검증하고 새 비밀번호로 변경한다.',
  })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({
    description: '비밀번호 변경 완료',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    },
  })
  @UseGuards(JwtAuthGuard)
  @Post('seller/change-password')
  async sellerChangePassword(
    @CurrentUser() user: JwtUser,
    @Body() body: SellerChangePasswordBody,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const accountId = parseAccountId(user);
    await this.auth.changeSellerPassword({
      accountId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      req,
    });
    res.status(200).json({ ok: true });
  }
}

interface SellerLoginBody {
  username: string;
  password: string;
}

interface SellerChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

function parseAccountId(user: JwtUser): bigint {
  try {
    return BigInt(user.accountId);
  } catch {
    throw new BadRequestException('Invalid account id.');
  }
}
