import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityProvider } from '@prisma/client';
import { Issuer, generators, type Client, type TokenSet } from 'openid-client';

import type { OidcProvider } from '../types/oidc-provider.type';

/**
 * OIDC Client를 생성/캐싱하고, 인증 URL 생성 및 콜백 처리까지 담당한다.
 */
@Injectable()
export class OidcClientService {
  private readonly clients = new Map<OidcProvider, Client>();

  /**
   * @param config ConfigService
   */
  constructor(private readonly config: ConfigService) {}

  /**
   * Provider별 issuer/client를 준비한다.
   *
   * @param provider provider
   */
  async getClient(provider: OidcProvider): Promise<Client> {
    const cached = this.clients.get(provider);
    if (cached) return cached;

    const { issuerUrl, clientId, clientSecret, redirectUri } =
      this.getProviderConfig(provider);

    const issuer = await Issuer.discover(issuerUrl);

    const client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code'],
    });

    this.clients.set(provider, client);
    return client;
  }

  /**
   * 인증 시작에 필요한 state/nonce/pkce 및 authorizationUrl을 만든다.
   *
   * @param provider provider
   */
  async buildAuthorizationUrl(provider: OidcProvider): Promise<{
    authorizationUrl: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  }> {
    const client = await this.getClient(provider);

    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const authorizationUrl = client.authorizationUrl({
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { authorizationUrl, state, nonce, codeVerifier };
  }

  /**
   * OIDC callback 처리 후 TokenSet을 반환한다.
   *
   * @param provider provider
   * @param args 콜백 파라미터
   */
  async exchangeCode(
    provider: OidcProvider,
    args: {
      redirectUri: string;
      callbackParams: Record<string, string | string[]>;
      state: string;
      nonce: string;
      codeVerifier: string;
    },
  ): Promise<TokenSet> {
    const client = await this.getClient(provider);
    return client.callback(args.redirectUri, args.callbackParams, {
      state: args.state,
      nonce: args.nonce,
      code_verifier: args.codeVerifier,
    });
  }

  /**
   * provider에 해당하는 IdentityProvider(enum)로 변환한다.
   *
   * @param provider provider
   */
  toIdentityProvider(provider: OidcProvider): IdentityProvider {
    if (provider === 'google') return IdentityProvider.GOOGLE;
    return IdentityProvider.KAKAO;
  }

  /**
   * Provider별 설정을 반환한다.
   *
   * @param provider provider
   */
  private getProviderConfig(provider: OidcProvider): {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } {
    const backendBaseUrl =
      this.config.get<string>('BACKEND_BASE_URL')?.trim() ??
      'http://localhost:4000';

    if (provider === 'google') {
      const issuerUrl = this.mustGet('OIDC_GOOGLE_ISSUER_URL');
      const clientId = this.mustGet('OIDC_GOOGLE_CLIENT_ID');
      const clientSecret = this.mustGet('OIDC_GOOGLE_CLIENT_SECRET');
      const redirectUri = `${backendBaseUrl}/auth/oidc/google/callback`;
      return { issuerUrl, clientId, clientSecret, redirectUri };
    }

    const issuerUrl = this.mustGet('OIDC_KAKAO_ISSUER_URL');
    const clientId = this.mustGet('OIDC_KAKAO_CLIENT_ID');
    const clientSecret = this.mustGet('OIDC_KAKAO_CLIENT_SECRET');
    const redirectUri = `${backendBaseUrl}/auth/oidc/kakao/callback`;
    return { issuerUrl, clientId, clientSecret, redirectUri };
  }

  /**
   * 환경변수 필수값을 읽는다(없으면 fail-fast).
   *
   * @param key env key
   */
  private mustGet(key: string): string {
    const v = this.config.get<string>(key);
    if (!v || v.trim().length === 0) {
      throw new Error(`Missing required env: ${key}`);
    }
    return v.trim();
  }
}
