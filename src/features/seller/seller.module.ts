import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { ConversationModule } from '@/features/conversation';
import { OrderModule } from '@/features/order';
import { ProductModule } from '@/features/product';
import { StoreModule } from '@/features/store';

@Module({
  imports: [
    OrderModule,
    ProductModule,
    ConversationModule,
    AuditLogModule,
    StoreModule,
  ],
  // 03c까지 전부 도메인 feature로 옮겨져 provider가 없다 — 03d에서 디렉터리째 삭제
  providers: [],
})
export class SellerModule {}
