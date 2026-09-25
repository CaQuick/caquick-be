import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { AuthConfig } from '@/config/auth.config';
import type { JwtPublicJwk } from '@/config/jwt-key';

/**
 * 액세스 토큰(RS256) 검증용 공개키 공개. 서비스가 쪼개지면 각 서비스가 이 문서로 토큰을 검증한다 —
 * 지금은 같은 프로세스가 검증하지만 계약을 먼저 열어 둔다. 공개 엔드포인트라 인증이 없다.
 */
@ApiTags('Auth')
@Controller('.well-known')
export class JwksController {
  constructor(private readonly config: ConfigService) {}

  @Get('jwks.json')
  @ApiOperation({
    summary: 'JWKS (공개키 목록)',
    description:
      '액세스 토큰 서명 검증용 RSA 공개키를 JWK Set으로 돌려준다. kid는 RFC 7638 썸프린트다.',
  })
  @ApiResponse({ status: 200, description: 'JWK Set' })
  getJwks(): { keys: JwtPublicJwk[] } {
    const auth = this.config.getOrThrow<AuthConfig>('auth');
    return { keys: [auth.jwtKeys.publicJwk] };
  }
}
