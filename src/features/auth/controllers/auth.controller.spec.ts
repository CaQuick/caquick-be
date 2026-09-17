import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { AuthService } from '@/features/auth/auth.service';
import { AuthController } from '@/features/auth/controllers/auth.controller';
import { CredentialAuthService } from '@/features/auth/services/credential-auth.service';
import { OidcLoginService } from '@/features/auth/services/oidc-login.service';
import type { JwtUser } from '@/global/auth';

function mockRes(): Response {
  return {
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('AuthController', () => {
  let controller: AuthController;
  let auth: jest.Mocked<AuthService>;
  let oidcLogin: jest.Mocked<OidcLoginService>;
  let credentialAuth: jest.Mocked<CredentialAuthService>;

  beforeEach(async () => {
    auth = {
      refresh: jest.fn(),
      logout: jest.fn(),
      issueDevAccessToken: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    oidcLogin = {
      startOidcLogin: jest.fn(),
      handleOidcCallback: jest.fn(),
    } as unknown as jest.Mocked<OidcLoginService>;

    credentialAuth = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      changePassword: jest.fn(),
    } as unknown as jest.Mocked<CredentialAuthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: OidcLoginService, useValue: oidcLogin },
        { provide: CredentialAuthService, useValue: credentialAuth },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('start는 OIDC 인증 URL로 리다이렉트해야 한다', async () => {
    const res = {
      redirect: jest.fn(),
    } as unknown as Response;

    oidcLogin.startOidcLogin.mockResolvedValue({
      redirectUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    });

    await controller.start('google', 'https://caquick.site/login', res);

    expect(oidcLogin.startOidcLogin).toHaveBeenCalledWith(
      'google',
      'https://caquick.site/login',
      res,
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
  });

  it('callback은 returnTo로 리다이렉트해야 한다', async () => {
    const req = {
      query: {
        code: 'auth-code',
        state: 'state-1',
      },
      cookies: {},
    } as unknown as Request;
    const res = {
      redirect: jest.fn(),
    } as unknown as Response;

    oidcLogin.handleOidcCallback.mockResolvedValue({
      returnTo: 'https://caquick.site/mypage',
      accessToken: 'access-token',
    });

    await controller.callback('google', req, res);

    expect(oidcLogin.handleOidcCallback).toHaveBeenCalledWith(
      'google',
      req,
      res,
    );
    expect(res.redirect).toHaveBeenCalledWith('https://caquick.site/mypage');
  });

  it('refresh는 200 + accessToken JSON으로 응답한다', async () => {
    const res = mockRes();
    const req = {} as Request;
    auth.refresh.mockResolvedValue({
      accessToken: 'new-access',
    });

    await controller.refresh(req, res);

    expect(auth.refresh).toHaveBeenCalledWith(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      accessToken: 'new-access',
      tokenType: 'Bearer',
    });
  });

  it('logout은 204 + empty body로 응답한다', async () => {
    const res = mockRes();
    const req = {} as Request;

    await controller.logout(req, res);

    expect(auth.logout).toHaveBeenCalledWith(req, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  describe.each([
    {
      role: 'SELLER' as const,
      prefix: 'seller',
      pick: (c: AuthController) => ({
        login: c.sellerLogin.bind(c),
        refresh: c.sellerRefresh.bind(c),
        logout: c.sellerLogout.bind(c),
        changePassword: c.sellerChangePassword.bind(c),
      }),
    },
    {
      role: 'ADMIN' as const,
      prefix: 'admin',
      pick: (c: AuthController) => ({
        login: c.adminLogin.bind(c),
        refresh: c.adminRefresh.bind(c),
        logout: c.adminLogout.bind(c),
        changePassword: c.adminChangePassword.bind(c),
      }),
    },
  ])('$prefix 자격증명 엔드포인트', ({ role, prefix, pick }) => {
    it(`${prefix}Login은 role=${role}로 위임하고 accessToken·accountStatus·mustChangePassword를 응답한다`, async () => {
      const res = mockRes();
      const req = {} as Request;
      credentialAuth.login.mockResolvedValue({
        accessToken: 'access',
        accountStatus: 'ACTIVE',
        mustChangePassword: true,
      });

      await pick(controller).login(
        { username: 'who', password: 'pw1234!A' },
        req,
        res,
      );

      expect(credentialAuth.login).toHaveBeenCalledWith({
        role,
        username: 'who',
        password: 'pw1234!A',
        req,
        res,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        accessToken: 'access',
        tokenType: 'Bearer',
        accountStatus: 'ACTIVE',
        mustChangePassword: true,
      });
    });

    it(`${prefix}Refresh는 role=${role}로 위임한다`, async () => {
      const res = mockRes();
      const req = {} as Request;
      credentialAuth.refresh.mockResolvedValue({
        accessToken: 'rotated',
        accountStatus: 'ACTIVE',
        mustChangePassword: false,
      });

      await pick(controller).refresh(req, res);

      expect(credentialAuth.refresh).toHaveBeenCalledWith({ role, req, res });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        accessToken: 'rotated',
        tokenType: 'Bearer',
        accountStatus: 'ACTIVE',
        mustChangePassword: false,
      });
    });

    it(`${prefix}Logout은 role=${role}로 위임하고 204로 응답한다`, async () => {
      const res = mockRes();
      const req = {} as Request;

      await pick(controller).logout(req, res);

      expect(credentialAuth.logout).toHaveBeenCalledWith({ role, req, res });
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });

    it(`${prefix}ChangePassword는 parseAccountId 후 role=${role}로 위임하고 {ok:true}를 반환한다`, async () => {
      const res = mockRes();
      const req = {} as Request;

      const user: JwtUser = { accountId: '42', accountType: role };
      await pick(controller).changePassword(
        user,
        { currentPassword: 'old!Pass1', newPassword: 'New!Pass1' },
        req,
        res,
      );

      expect(credentialAuth.changePassword).toHaveBeenCalledWith({
        role,
        accountId: BigInt(42),
        currentPassword: 'old!Pass1',
        newPassword: 'New!Pass1',
        req,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it(`${prefix}ChangePassword는 accountId가 BigInt로 파싱 불가하면 BadRequestException`, async () => {
      const res = mockRes();
      const req = {} as Request;

      const badUser: JwtUser = { accountId: 'not-a-number', accountType: role };
      await expect(
        pick(controller).changePassword(
          badUser,
          { currentPassword: 'old', newPassword: 'new' },
          req,
          res,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('devIssueToken', () => {
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    });

    it('NODE_ENV=production이면 ForbiddenException', async () => {
      process.env.NODE_ENV = 'production';
      const res = mockRes();

      await expect(
        controller.devIssueToken({ accountId: '1' }, res),
      ).rejects.toThrow(ForbiddenException);
      expect(auth.issueDevAccessToken).not.toHaveBeenCalled();
    });

    it('accountId 문자열이 누락되면 BadRequestException', async () => {
      process.env.NODE_ENV = 'development';
      const res = mockRes();

      await expect(
        controller.devIssueToken({} as unknown as { accountId: string }, res),
      ).rejects.toThrow(BadRequestException);
    });

    it('accountId가 BigInt로 파싱 불가하면 BadRequestException', async () => {
      process.env.NODE_ENV = 'development';
      const res = mockRes();

      await expect(
        controller.devIssueToken({ accountId: 'not-a-number' }, res),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 발급: service 위임 + 200 응답', async () => {
      process.env.NODE_ENV = 'development';
      const res = mockRes();

      auth.issueDevAccessToken.mockResolvedValue({
        accessToken: 't',
        tokenType: 'Bearer',
        expiresInSeconds: 900,
      });

      await controller.devIssueToken({ accountId: '5' }, res);

      expect(auth.issueDevAccessToken).toHaveBeenCalledWith(BigInt(5));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        accessToken: 't',
        tokenType: 'Bearer',
        expiresInSeconds: 900,
      });
    });
  });
});
