import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Issuer,
  generators,
  type Client,
  type ClientAuthMethod,
  type TokenSet,
} from 'openid-client';

import { mustGetEnv } from '@/common/helpers/config.helper';
import type { OidcProvider } from '@/features/auth/types/oidc-provider.type';
import { IdentityProvider } from '@/generated/prisma/client';

@Injectable()
export class OidcClientService {
  private readonly clients = new Map<OidcProvider, Client>();

  constructor(private readonly config: ConfigService) {}

  async getClient(provider: OidcProvider): Promise<Client> {
    const cached = this.clients.get(provider);
    if (cached) return cached;

    const {
      issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      tokenEndpointAuthMethod,
    } = this.getProviderConfig(provider);

    const issuer = await Issuer.discover(issuerUrl);

    const client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code'],
      // 카카오 토큰 엔드포인트는 client_secret_post만 지원한다.
      // openid-client 기본값(client_secret_basic)을 쓰면 invalid_client로 거부된다.
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    });

    this.clients.set(provider, client);
    return client;
  }

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
      scope: this.getScope(provider),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { authorizationUrl, state, nonce, codeVerifier };
  }

  /**
   * 카카오는 표준 `email`/`profile`이 아니라 자체 동의항목 ID(`account_email`/`profile_nickname`/`profile_image`)를
   * 쓴다 — 표준 scope를 보내면 KOE205(invalid_scope). 콘솔의 동의항목과 맞추도록 env(`OIDC_*_SCOPE`)로 덮어쓸 수 있다.
   */
  private getScope(provider: OidcProvider): string {
    if (provider === 'google') {
      return (
        this.config.get<string>('OIDC_GOOGLE_SCOPE')?.trim() ||
        'openid email profile'
      );
    }
    return (
      this.config.get<string>('OIDC_KAKAO_SCOPE')?.trim() ||
      'openid account_email profile_nickname profile_image'
    );
  }

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

  toIdentityProvider(provider: OidcProvider): IdentityProvider {
    if (provider === 'google') return IdentityProvider.GOOGLE;
    return IdentityProvider.KAKAO;
  }

  private getProviderConfig(provider: OidcProvider): {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    tokenEndpointAuthMethod: ClientAuthMethod;
  } {
    const backendBaseUrl =
      this.config.get<string>('BACKEND_BASE_URL')?.trim() ??
      'http://localhost:4000';

    if (provider === 'google') {
      const issuerUrl = this.mustGet('OIDC_GOOGLE_ISSUER_URL');
      const clientId = this.mustGet('OIDC_GOOGLE_CLIENT_ID');
      const clientSecret = this.mustGet('OIDC_GOOGLE_CLIENT_SECRET');
      const redirectUri = `${backendBaseUrl}/auth/oidc/google/callback`;
      // 구글은 basic/post 모두 지원 → openid-client 기본값(basic) 유지
      return {
        issuerUrl,
        clientId,
        clientSecret,
        redirectUri,
        tokenEndpointAuthMethod: 'client_secret_basic',
      };
    }

    const issuerUrl = this.mustGet('OIDC_KAKAO_ISSUER_URL');
    const clientId = this.mustGet('OIDC_KAKAO_CLIENT_ID');
    const clientSecret = this.mustGet('OIDC_KAKAO_CLIENT_SECRET');
    const redirectUri = `${backendBaseUrl}/auth/oidc/kakao/callback`;
    // 카카오는 client_secret_post만 지원
    return {
      issuerUrl,
      clientId,
      clientSecret,
      redirectUri,
      tokenEndpointAuthMethod: 'client_secret_post',
    };
  }

  private mustGet(key: string): string {
    return mustGetEnv(this.config, key);
  }
}
