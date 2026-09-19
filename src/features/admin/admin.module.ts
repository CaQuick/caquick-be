import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { OrderModule } from '@/features/order';
import { SearchModule } from '@/features/search';

/** cross-feature로 쓰이지 않아 배럴이 없다. DI는 구체 클래스 주입(2번째 구현 예정 없음). */
@Module({
  imports: [AuditLogModule, AuthModule, OrderModule, SearchModule],
  // 04d까지 전부 도메인 feature로 옮겨져 provider가 없다 — 04e에서 디렉터리째 삭제
  providers: [],
})
export class AdminModule {}
