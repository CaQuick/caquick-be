import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityProvider } from '@prisma/client';
import {
  Issuer,
  generators,
  type Client,
  type ClientAuthMethod,
  type TokenSet,
} from 'openid-client';

import { mustGetEnv } from '@/common/helpers/config.helper';
import type { OidcProvider } from '@/features/auth/types/oidc-provider.type';

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
      scope: this.getScope(provider),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { authorizationUrl, state, nonce, codeVerifier };
  }

  /**
   * provider별 OIDC scope를 반환한다.
   *
   * 카카오는 표준 `email`/`profile`이 아니라 자체 동의항목 ID
   * (`account_email`/`profile_nickname`/`profile_image`)를 사용한다. 표준 scope를 보내면
   * KOE205(invalid_scope)가 발생하므로 provider별로 분리한다.
   * 콘솔에 활성화한 동의항목과 정확히 맞추도록 env(`OIDC_GOOGLE_SCOPE`/`OIDC_KAKAO_SCOPE`)로
   * 덮어쓸 수 있다(예: account_email 미승인 시 카카오 scope에서 제외).
   *
   * @param provider provider
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

  /**
   * 환경변수 필수값을 읽는다(없으면 fail-fast).
   *
   * @param key env key
   */
  private mustGet(key: string): string {
    return mustGetEnv(this.config, key);
  }
}
