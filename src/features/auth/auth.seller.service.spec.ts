import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import argon2 from 'argon2';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { AuthRepository } from './repositories/auth.repository';
import { OidcClientService } from './services/oidc-client.service';

describe('AuthService (seller)', () => {
  let service: AuthService;
  let repo: jest.Mocked<AuthRepository>;

  beforeEach(async () => {
    repo = {
      findSellerCredentialByUsername: jest.fn(),
      updateSellerLastLogin: jest.fn(),
      createRefreshSession: jest.fn(),
    } as unknown as jest.Mocked<AuthRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: JwtService, useValue: { sign: jest.fn(() => 'token') } },
        { provide: OidcClientService, useValue: {} },
        { provide: AuthRepository, useValue: repo },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('판매자 로그인 성공 시 accountStatus를 반환해야 한다', async () => {
    const verifySpy = jest.spyOn(argon2, 'verify').mockResolvedValue(true);

    repo.findSellerCredentialByUsername.mockResolvedValue({
      seller_account_id: BigInt(1),
      password_hash: 'hashed',
      seller_account: {
        account_type: 'SELLER',
        status: 'PENDING',
      },
    } as never);

    const req = {
      headers: {},
      ip: '127.0.0.1',
    } as unknown as Request;
    const res = {
      cookie: jest.fn(),
    } as unknown as Response;

    const result = await service.sellerLogin({
      username: 'seller',
      password: 'Password!123',
      req,
      res,
    });

    expect(result.accountStatus).toBe('PENDING');
    verifySpy.mockRestore();
  });
});
