import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';

/** 판매자·관리자 공통 로그인/재발급 응답 스키마(Swagger). */
const CREDENTIAL_LOGIN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    tokenType: { type: 'string', example: 'Bearer' },
    expiresInSeconds: { type: 'number', example: 900 },
    accountStatus: {
      type: 'string',
      enum: ['PENDING', 'ACTIVE', 'SUSPENDED'],
    },
    mustChangePassword: { type: 'boolean' },
  },
  required: [
    'accessToken',
    'tokenType',
    'expiresInSeconds',
    'accountStatus',
    'mustChangePassword',
  ],
};

export type CredentialRoleLabel = '판매자' | '관리자';

/** 판매자만 바디 전달(앱)이 있어 refresh 토큰 필드가 붙는다. */
const SELLER_LOGIN_RESPONSE_SCHEMA = {
  ...CREDENTIAL_LOGIN_RESPONSE_SCHEMA,
  properties: {
    ...CREDENTIAL_LOGIN_RESPONSE_SCHEMA.properties,
    refreshToken: {
      type: 'string',
      description: '바디 모드에서만. 재발급마다 바뀌므로 교체 저장한다.',
    },
    refreshExpiresAt: {
      type: 'string',
      format: 'date-time',
      description: '바디 모드에서만. refresh 토큰 만료 시각.',
    },
  },
};

function loginResponseSchemaOf(role: CredentialRoleLabel) {
  return role === '판매자'
    ? SELLER_LOGIN_RESPONSE_SCHEMA
    : CREDENTIAL_LOGIN_RESPONSE_SCHEMA;
}

const SELLER_MOBILE_LOGIN_NOTE =
  ' `X-Client: mobile`이면 refresh 토큰을 쿠키 대신 응답 바디(`refreshToken`·`refreshExpiresAt`)로 돌려준다.';
const SELLER_BODY_TOKEN_NOTE =
  ' 바디 `refreshToken`이 있으면 그것을(쿠키는 읽지 않음), 없으면 쿠키를 쓴다.';

const REFRESH_TOKEN_BODY = ApiBody({
  required: false,
  description: '판매자 앱 전용. 비우면 쿠키 모드.',
  schema: {
    type: 'object',
    properties: {
      refreshToken: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    },
  },
});

/** main.ts의 addCookieAuth 스킴 이름 — 역할마다 refresh 쿠키 이름이 다르다. */
const REFRESH_COOKIE_SCHEME: Record<CredentialRoleLabel, string> = {
  판매자: 'seller-refresh-cookie',
  관리자: 'admin-refresh-cookie',
};

/**
 * 자격증명(username/password) REST 문서 데코레이터 4묶음.
 * 판매자·관리자 핸들러 8개가 같은 문서 모양을 쓰며, 라우트·가드·본문은 각 핸들러에 남는다.
 */
export function ApiCredentialLogin(role: CredentialRoleLabel): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: `${role} 로그인`,
      description:
        role === '관리자'
          ? '관리자 username/password로 로그인한다. mustChangePassword=true면 비밀번호를 바꾸기 전까지 관리자 API가 FORBIDDEN이다.'
          : '판매자 username/password로 로그인한다.' + SELLER_MOBILE_LOGIN_NOTE,
    }),
    ...(role === '판매자'
      ? [
          ApiHeader({
            name: 'X-Client',
            required: false,
            enum: ['mobile'],
            description: '앱은 mobile. 웹은 보내지 않는다(쿠키 모드).',
          }),
        ]
      : []),
    ApiOkResponse({
      description: `${role} 로그인 결과`,
      schema: loginResponseSchemaOf(role),
    }),
  );
}

export function ApiCredentialRefresh(
  role: CredentialRoleLabel,
): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: `${role} Access/Refresh 재발급`,
      description:
        `${role} refresh 쿠키를 사용해 access token을 재발급한다.` +
        (role === '판매자' ? SELLER_BODY_TOKEN_NOTE : ''),
    }),
    ApiCookieAuth(REFRESH_COOKIE_SCHEME[role]),
    ...(role === '판매자' ? [REFRESH_TOKEN_BODY] : []),
    ApiOkResponse({
      description: `${role} 재발급 결과`,
      schema: loginResponseSchemaOf(role),
    }),
  );
}

export function ApiCredentialLogout(
  role: CredentialRoleLabel,
): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: `${role} 로그아웃`,
      description:
        `${role} refresh 세션을 폐기하고 쿠키를 제거한다.` +
        (role === '판매자' ? SELLER_BODY_TOKEN_NOTE : ''),
    }),
    ApiCookieAuth(REFRESH_COOKIE_SCHEME[role]),
    ...(role === '판매자' ? [REFRESH_TOKEN_BODY] : []),
    ApiNoContentResponse({ description: `${role} 로그아웃 완료` }),
  );
}

export function ApiChangePassword(role: CredentialRoleLabel): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: `${role} 비밀번호 변경`,
      description:
        '현재 비밀번호를 검증하고 새 비밀번호로 변경한다. 초기 비밀번호 상태(mustChangePassword)가 해제된다.',
    }),
    ApiBearerAuth('access-token'),
    ApiOkResponse({
      description: '비밀번호 변경 완료',
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      },
    }),
  );
}
