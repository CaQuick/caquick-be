import { Module } from '@nestjs/common';

import { ConversationModule } from '@/features/conversation';
import { OrderModule } from '@/features/order';
import { ProductModule } from '@/features/product';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerContentMutationResolver } from '@/features/seller/resolvers/seller-content-mutation.resolver';
import { SellerContentQueryResolver } from '@/features/seller/resolvers/seller-content-query.resolver';
import { SellerConversationMutationResolver } from '@/features/seller/resolvers/seller-conversation-mutation.resolver';
import { SellerConversationQueryResolver } from '@/features/seller/resolvers/seller-conversation-query.resolver';
import { SellerOrderMutationResolver } from '@/features/seller/resolvers/seller-order-mutation.resolver';
import { SellerOrderQueryResolver } from '@/features/seller/resolvers/seller-order-query.resolver';
import { SellerProductMutationResolver } from '@/features/seller/resolvers/seller-product-mutation.resolver';
import { SellerProductQueryResolver } from '@/features/seller/resolvers/seller-product-query.resolver';
import { SellerStoreMutationResolver } from '@/features/seller/resolvers/seller-store-mutation.resolver';
import { SellerStoreQueryResolver } from '@/features/seller/resolvers/seller-store-query.resolver';
import { SellerContentService } from '@/features/seller/services/seller-content.service';
import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerOrderService } from '@/features/seller/services/seller-order.service';
import { SellerProductCrudService } from '@/features/seller/services/seller-product-crud.service';
import { SellerStoreService } from '@/features/seller/services/seller-store.service';

@Module({
  imports: [OrderModule, ProductModule, ConversationModule],
  providers: [
    SellerStoreService,
    SellerProductCrudService,
    SellerOptionService,
    SellerCustomTemplateService,
    SellerOrderService,
    SellerConversationService,
    SellerContentService,
    SellerRepository,
    SellerStoreQueryResolver,
    SellerProductQueryResolver,
    SellerOrderQueryResolver,
    SellerConversationQueryResolver,
    SellerContentQueryResolver,
    SellerStoreMutationResolver,
    SellerProductMutationResolver,
    SellerOrderMutationResolver,
    SellerConversationMutationResolver,
    SellerContentMutationResolver,
  ],
})
export class SellerModule {}
