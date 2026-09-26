import { Global, Module } from '@nestjs/common';

import { TokenBlacklistService } from '@/global/auth/blacklist/token-blacklist.service';
import { RedisModule } from '@/global/redis';

/** JwtModule(AuthGlobalModule)과 분리한다 — 서명·검증 배선만 보는 spec이 Redis까지 끌어오지 않게. */
@Global()
@Module({
  imports: [RedisModule],
  providers: [TokenBlacklistService],
  exports: [TokenBlacklistService],
})
export class BlacklistModule {}
