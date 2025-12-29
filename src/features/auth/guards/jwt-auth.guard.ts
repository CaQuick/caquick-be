import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * REST용 JWT 인증 가드
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
