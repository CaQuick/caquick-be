import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { AuthService } from '../auth.service';

import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;
  let auth: jest.Mocked<AuthService>;

  beforeEach(async () => {
    auth = {
      startOidcLogin: jest.fn(),
      handleOidcCallback: jest.fn(),
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
});
