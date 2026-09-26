import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';

/** 판매자·관리자 로그인/재발급 응답 스키마(Swagger). 두 경로가 같은 모양을 쓴다. */
const CREDENTIAL_LOGIN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    tokenType: { type: 'string', example: 'Bearer' },
    accountStatus: {
      type: 'string',
      enum: ['PENDING', 'ACTIVE', 'SUSPENDED'],
    },
    mustChangePassword: { type: 'boolean' },
  },
  required: ['accessToken', 'tokenType', 'accountStatus', 'mustChangePassword'],
};

export type CredentialRoleLabel = '판매자' | '관리자';

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
          : '판매자 username/password로 로그인한다.',
    }),
    ApiOkResponse({
      description: `${role} 로그인 결과`,
      schema: CREDENTIAL_LOGIN_RESPONSE_SCHEMA,
    }),
  );
}

export function ApiCredentialRefresh(
  role: CredentialRoleLabel,
): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: `${role} Access/Refresh 재발급`,
      description: `${role} refresh 쿠키를 사용해 access token을 재발급한다.`,
    }),
    ApiCookieAuth('refresh-cookie'),
    ApiOkResponse({
      description: `${role} 재발급 결과`,
      schema: CREDENTIAL_LOGIN_RESPONSE_SCHEMA,
    }),
  );
}

export function ApiCredentialLogout(
  role: CredentialRoleLabel,
): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: `${role} 로그아웃`,
      description: `${role} refresh 세션을 폐기하고 쿠키를 제거한다.`,
    }),
    ApiCookieAuth('refresh-cookie'),
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
