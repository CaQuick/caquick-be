import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { IdentityProvider } from '@prisma/client';

import { OidcClientService } from './oidc-client.service';

// openid-client 모킹
jest.mock('openid-client', () => ({
  Issuer: {
    discover: jest.fn(),
  },
  generators: {
    state: jest.fn(() => 'mock-state'),
    nonce: jest.fn(() => 'mock-nonce'),
    codeVerifier: jest.fn(() => 'mock-verifier'),
    codeChallenge: jest.fn(() => 'mock-challenge'),
  },
}));

describe('OidcClientService', () => {
  let service: OidcClientService;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockClient: {
    authorizationUrl: jest.Mock;
    callback: jest.Mock;
  };
  let mockIssuer: {
    Client: jest.Mock;
  };

  beforeEach(async () => {
    mockConfig = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    mockClient = {
      authorizationUrl: jest.fn(),
      callback: jest.fn(),
    };

    mockIssuer = {
      Client: jest.fn(() => mockClient),
    };

    const { Issuer } = require('openid-client');
    (Issuer.discover as jest.Mock).mockResolvedValue(mockIssuer);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OidcClientService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<OidcClientService>(OidcClientService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getClient', () => {
    it('Google provider의 client를 생성하고 캐싱해야 한다', async () => {
      // Arrange
      mockConfig.get.mockImplementation((key: string) => {
        const config: Record<string, string> = {
          OIDC_GOOGLE_ISSUER_URL: 'https://accounts.google.com',
          OIDC_GOOGLE_CLIENT_ID: 'google-client-id',
          OIDC_GOOGLE_CLIENT_SECRET: 'google-client-secret',
          BACKEND_BASE_URL: 'http://localhost:4000',
        };
        return config[key];
      });

      // Act
      const client1 = await service.getClient('google');
      const client2 = await service.getClient('google');

      // Assert
      expect(client1).toBe(client2); // 캐싱 확인
      expect(mockIssuer.Client).toHaveBeenCalledTimes(1); // 한 번만 생성
      expect(mockIssuer.Client).toHaveBeenCalledWith({
        client_id: 'google-client-id',
        client_secret: 'google-client-secret',
        redirect_uris: ['http://localhost:4000/auth/oidc/google/callback'],
        response_types: ['code'],
      });
    });

    it('Kakao provider의 client를 생성해야 한다', async () => {
      // Arrange
      mockConfig.get.mockImplementation((key: string) => {
        const config: Record<string, string> = {
          OIDC_KAKAO_ISSUER_URL: 'https://kauth.kakao.com',
          OIDC_KAKAO_CLIENT_ID: 'kakao-client-id',
          OIDC_KAKAO_CLIENT_SECRET: 'kakao-client-secret',
          BACKEND_BASE_URL: 'http://localhost:4000',
        };
        return config[key];
      });

      // Act
      await service.getClient('kakao');

      // Assert
      expect(mockIssuer.Client).toHaveBeenCalledWith({
        client_id: 'kakao-client-id',
        client_secret: 'kakao-client-secret',
        redirect_uris: ['http://localhost:4000/auth/oidc/kakao/callback'],
        response_types: ['code'],
      });
    });

    it('필수 환경 변수가 없으면 에러를 던져야 한다', async () => {
      // Arrange
      mockConfig.get.mockReturnValue(undefined);

      // Act & Assert
      await expect(service.getClient('google')).rejects.toThrow(
        'Missing required environment variable',
      );
    });
  });

  describe('buildAuthorizationUrl', () => {
    beforeEach(() => {
      mockConfig.get.mockImplementation((key: string) => {
        const config: Record<string, string> = {
          OIDC_GOOGLE_ISSUER_URL: 'https://accounts.google.com',
          OIDC_GOOGLE_CLIENT_ID: 'google-client-id',
          OIDC_GOOGLE_CLIENT_SECRET: 'google-client-secret',
          BACKEND_BASE_URL: 'http://localhost:4000',
        };
        return config[key];
      });
    });

    it('인증 URL과 PKCE 파라미터를 생성해야 한다', async () => {
      // Arrange
      mockClient.authorizationUrl.mockReturnValue(
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=...',
      );

      // Act
      const result = await service.buildAuthorizationUrl('google');

      // Assert
      expect(result).toEqual({
        authorizationUrl:
          'https://accounts.google.com/o/oauth2/v2/auth?client_id=...',
        state: 'mock-state',
        nonce: 'mock-nonce',
        codeVerifier: 'mock-verifier',
      });

      expect(mockClient.authorizationUrl).toHaveBeenCalledWith({
        scope: 'openid email profile',
        state: 'mock-state',
        nonce: 'mock-nonce',
        code_challenge: 'mock-challenge',
        code_challenge_method: 'S256',
      });
    });
  });

  describe('exchangeCode', () => {
    beforeEach(() => {
      mockConfig.get.mockImplementation((key: string) => {
        const config: Record<string, string> = {
          OIDC_GOOGLE_ISSUER_URL: 'https://accounts.google.com',
          OIDC_GOOGLE_CLIENT_ID: 'google-client-id',
          OIDC_GOOGLE_CLIENT_SECRET: 'google-client-secret',
          BACKEND_BASE_URL: 'http://localhost:4000',
        };
        return config[key];
      });
    });

    it('authorization code를 token으로 교환해야 한다', async () => {
      // Arrange
      const mockTokenSet = {
        access_token: 'access-token',
        id_token: 'id-token',
        claims: () => ({ sub: 'user-123' }),
      };

      mockClient.callback.mockResolvedValue(mockTokenSet);

      const args = {
        redirectUri: 'http://localhost:4000/auth/oidc/google/callback',
        callbackParams: {
          code: 'auth-code',
          state: 'state-123',
        },
        state: 'state-123',
        nonce: 'nonce-123',
        codeVerifier: 'verifier-123',
      };

      // Act
      const result = await service.exchangeCode('google', args);

      // Assert
      expect(result).toEqual(mockTokenSet);
      expect(mockClient.callback).toHaveBeenCalledWith(
        'http://localhost:4000/auth/oidc/google/callback',
        { code: 'auth-code', state: 'state-123' },
        {
          state: 'state-123',
          nonce: 'nonce-123',
          code_verifier: 'verifier-123',
        },
      );
    });
  });

  describe('toIdentityProvider', () => {
    it('google provider를 GOOGLE enum으로 변환해야 한다', () => {
      // Act
      const result = service.toIdentityProvider('google');

      // Assert
      expect(result).toBe(IdentityProvider.GOOGLE);
    });

    it('kakao provider를 KAKAO enum으로 변환해야 한다', () => {
      // Act
      const result = service.toIdentityProvider('kakao');

      // Assert
      expect(result).toBe(IdentityProvider.KAKAO);
    });
  });
});
