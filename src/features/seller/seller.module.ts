import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { ConversationModule } from '@/features/conversation';
import { OrderModule } from '@/features/order';
import { ProductModule } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerContentQueryResolver } from '@/features/seller/resolvers/seller-content-query.resolver';
import { SellerConversationMutationResolver } from '@/features/seller/resolvers/seller-conversation-mutation.resolver';
import { SellerConversationQueryResolver } from '@/features/seller/resolvers/seller-conversation-query.resolver';
import { SellerOrderMutationResolver } from '@/features/seller/resolvers/seller-order-mutation.resolver';
import { SellerOrderQueryResolver } from '@/features/seller/resolvers/seller-order-query.resolver';
import { SellerAuditService } from '@/features/seller/services/seller-audit.service';
import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';
import { SellerOrderService } from '@/features/seller/services/seller-order.service';
import { StoreModule } from '@/features/store';

@Module({
  imports: [
    OrderModule,
    ProductModule,
    ConversationModule,
    AuditLogModule,
    StoreModule,
  ],
  providers: [
    SellerOrderService,
    SellerConversationService,
    SellerAuditService,
    SellerRepository,
    SellerOrderQueryResolver,
    SellerConversationQueryResolver,
    SellerContentQueryResolver,
    SellerOrderMutationResolver,
    SellerConversationMutationResolver,
  ],
})
export class SellerModule {}
