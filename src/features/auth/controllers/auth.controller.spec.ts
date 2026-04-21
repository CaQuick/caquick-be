import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { AuthService } from '@/features/auth/auth.service';
import { AuthController } from '@/features/auth/controllers/auth.controller';

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

  beforeEach(async () => {
    auth = {
      startOidcLogin: jest.fn(),
      handleOidcCallback: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      sellerLogin: jest.fn(),
      refreshSeller: jest.fn(),
      logoutSeller: jest.fn(),
      changeSellerPassword: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('start는 OIDC 인증 URL로 리다이렉트해야 한다', async () => {
    const res = {
      redirect: jest.fn(),
    } as unknown as Response;

    auth.startOidcLogin.mockResolvedValue({
      redirectUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    });

    await controller.start('google', 'https://caquick.site/login', res);

    expect(auth.startOidcLogin).toHaveBeenCalledWith(
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

    auth.handleOidcCallback.mockResolvedValue({
      returnTo: 'https://caquick.site/mypage',
      accessToken: 'access-token',
    });

    await controller.callback('google', req, res);

    expect(auth.handleOidcCallback).toHaveBeenCalledWith('google', req, res);
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

  it('sellerLogin은 accessToken + accountStatus를 응답한다', async () => {
    const res = mockRes();
    const req = {} as Request;
    auth.sellerLogin.mockResolvedValue({
      accessToken: 'seller-access',
      accountStatus: 'ACTIVE',
    });

    await controller.sellerLogin(
      { username: 'seller', password: 'pw1234!A' },
      req,
      res,
    );

    expect(auth.sellerLogin).toHaveBeenCalledWith({
      username: 'seller',
      password: 'pw1234!A',
      req,
      res,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      accessToken: 'seller-access',
      tokenType: 'Bearer',
      accountStatus: 'ACTIVE',
    });
  });

  it('sellerRefresh는 accessToken + accountStatus를 응답한다', async () => {
    const res = mockRes();
    const req = {} as Request;
    auth.refreshSeller.mockResolvedValue({
      accessToken: 'rotated',
      accountStatus: 'ACTIVE',
    });

    await controller.sellerRefresh(req, res);

    expect(auth.refreshSeller).toHaveBeenCalledWith(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      accessToken: 'rotated',
      tokenType: 'Bearer',
      accountStatus: 'ACTIVE',
    });
  });

  it('sellerLogout은 204로 응답한다', async () => {
    const res = mockRes();
    const req = {} as Request;

    await controller.sellerLogout(req, res);

    expect(auth.logoutSeller).toHaveBeenCalledWith(req, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it('sellerChangePassword는 parseAccountId 후 {ok:true}를 반환한다', async () => {
    const res = mockRes();
    const req = {} as Request;

    await controller.sellerChangePassword(
      { accountId: '42' },
      { currentPassword: 'old!Pass1', newPassword: 'New!Pass1' },
      req,
      res,
    );

    expect(auth.changeSellerPassword).toHaveBeenCalledWith({
      accountId: BigInt(42),
      currentPassword: 'old!Pass1',
      newPassword: 'New!Pass1',
      req,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('sellerChangePassword는 accountId가 BigInt로 파싱 불가하면 BadRequestException', async () => {
    const res = mockRes();
    const req = {} as Request;

    await expect(
      controller.sellerChangePassword(
        { accountId: 'not-a-number' },
        { currentPassword: 'old', newPassword: 'new' },
        req,
        res,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
