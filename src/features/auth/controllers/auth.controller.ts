import {
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

import { DomainException } from '@/common/errors/error-catalog';
import { AuthService } from '@/features/auth/auth.service';
import {
  ApiChangePassword,
  ApiCredentialLogin,
  ApiCredentialLogout,
  ApiCredentialRefresh,
} from '@/features/auth/decorators/credential-auth-docs.decorator';
import { ChangePasswordInput } from '@/features/auth/dto/inputs/change-password.input';
import { CredentialLoginInput } from '@/features/auth/dto/inputs/credential-login.input';
import { DevIssueTokenInput } from '@/features/auth/dto/inputs/dev-issue-token.input';
import {
  CredentialAuthService,
  type CredentialLoginResult,
} from '@/features/auth/services/credential-auth.service';
import { OidcLoginService } from '@/features/auth/services/oidc-login.service';
import { parseOidcProvider } from '@/features/auth/types/oidc-provider.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

function toCredentialLoginResponse(result: CredentialLoginResult): {
  accessToken: string;
  tokenType: 'Bearer';
  accountStatus: CredentialLoginResult['accountStatus'];
  mustChangePassword: boolean;
} {
  return {
    accessToken: result.accessToken,
    tokenType: 'Bearer',
    accountStatus: result.accountStatus,
    mustChangePassword: result.mustChangePassword,
  };
}

function parseAccountIdString(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new DomainException('INVALID_ACCOUNT_ID');
  }
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oidcLogin: OidcLoginService,
    private readonly credentialAuth: CredentialAuthService,
  ) {}

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
    parseOidcProvider(provider);

    const { redirectUrl } = await this.oidcLogin.startOidcLogin(
      provider,
      returnTo,
      res,
    );
    res.redirect(redirectUrl);
  }

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
    const { returnTo } = await this.oidcLogin.handleOidcCallback(
      provider,
      req,
      res,
    );
    res.redirect(returnTo);
  }

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

  @ApiCredentialLogin('판매자')
  @Post('seller/login')
  async sellerLogin(
    @Body() body: CredentialLoginInput,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.credentialAuth.login({
      role: 'SELLER',
      username: body.username,
      password: body.password,
      req,
      res,
    });
    res.status(200).json(toCredentialLoginResponse(result));
  }

  @ApiCredentialRefresh('판매자')
  @Post('seller/refresh')
  async sellerRefresh(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.credentialAuth.refresh({
      role: 'SELLER',
      req,
      res,
    });
    res.status(200).json(toCredentialLoginResponse(result));
  }

  @ApiCredentialLogout('판매자')
  @Post('seller/logout')
  async sellerLogout(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.credentialAuth.logout({ role: 'SELLER', req, res });
    res.status(204).send();
  }

  /** 시드 데이터의 accountId로 OIDC 흐름을 우회해 GraphQL Playground에서 마이페이지 API를 시험하기 위한 것. */
  @ApiOperation({
    summary: '[DEV ONLY] Access token 즉시 발급',
    description:
      '개발 환경에서 OIDC 흐름 없이 accountId로 access token을 발급한다. NODE_ENV=production 에서는 차단된다.',
  })
  @ApiOkResponse({
    description: 'Dev access token',
    schema: {
      type: 'object',
      properties: {
        accessToken: { type: 'string' },
        tokenType: { type: 'string', example: 'Bearer' },
        expiresInSeconds: { type: 'number', example: 900 },
      },
      required: ['accessToken', 'tokenType', 'expiresInSeconds'],
    },
  })
  @Post('dev/issue-token')
  async devIssueToken(
    @Body() body: DevIssueTokenInput,
    @Res() res: Response,
  ): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new DomainException('DEV_ONLY_ENDPOINT');
    }

    const accountId = parseAccountIdString(body.accountId);
    const result = await this.auth.issueDevAccessToken(accountId);
    res.status(200).json(result);
  }

  @ApiChangePassword('판매자')
  @UseGuards(JwtAuthGuard)
  @Post('seller/change-password')
  async sellerChangePassword(
    @CurrentUser() user: JwtUser,
    @Body() body: ChangePasswordInput,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const accountId = parseAccountId(user);
    await this.credentialAuth.changePassword({
      role: 'SELLER',
      accountId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      req,
    });
    res.status(200).json({ ok: true });
  }

  @ApiCredentialLogin('관리자')
  @Post('admin/login')
  async adminLogin(
    @Body() body: CredentialLoginInput,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.credentialAuth.login({
      role: 'ADMIN',
      username: body.username,
      password: body.password,
      req,
      res,
    });
    res.status(200).json(toCredentialLoginResponse(result));
  }

  @ApiCredentialRefresh('관리자')
  @Post('admin/refresh')
  async adminRefresh(@Req() req: Request, @Res() res: Response): Promise<void> {
    const result = await this.credentialAuth.refresh({
      role: 'ADMIN',
      req,
      res,
    });
    res.status(200).json(toCredentialLoginResponse(result));
  }

  @ApiCredentialLogout('관리자')
  @Post('admin/logout')
  async adminLogout(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.credentialAuth.logout({ role: 'ADMIN', req, res });
    res.status(204).send();
  }

  @ApiChangePassword('관리자')
  @UseGuards(JwtAuthGuard)
  @Post('admin/change-password')
  async adminChangePassword(
    @CurrentUser() user: JwtUser,
    @Body() body: ChangePasswordInput,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const accountId = parseAccountId(user);
    await this.credentialAuth.changePassword({
      role: 'ADMIN',
      accountId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      req,
    });
    res.status(200).json({ ok: true });
  }
}
