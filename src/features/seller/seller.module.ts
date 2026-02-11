import { Module } from '@nestjs/common';

import { OrderModule } from '../order/order.module';

import { SellerRepository } from './repositories/seller.repository';
import { SellerContentMutationResolver } from './resolvers/seller-content-mutation.resolver';
import { SellerContentQueryResolver } from './resolvers/seller-content-query.resolver';
import { SellerConversationMutationResolver } from './resolvers/seller-conversation-mutation.resolver';
import { SellerConversationQueryResolver } from './resolvers/seller-conversation-query.resolver';
import { SellerOrderMutationResolver } from './resolvers/seller-order-mutation.resolver';
import { SellerOrderQueryResolver } from './resolvers/seller-order-query.resolver';
import { SellerProductMutationResolver } from './resolvers/seller-product-mutation.resolver';
import { SellerProductQueryResolver } from './resolvers/seller-product-query.resolver';
import { SellerStoreMutationResolver } from './resolvers/seller-store-mutation.resolver';
import { SellerStoreQueryResolver } from './resolvers/seller-store-query.resolver';
import { SellerService } from './seller.service';
import { SellerContentService } from './services/seller-content.service';
import { SellerConversationService } from './services/seller-conversation.service';
import { SellerOrderService } from './services/seller-order.service';
import { SellerProductService } from './services/seller-product.service';
import { SellerStoreService } from './services/seller-store.service';

@Module({
  imports: [OrderModule],
  providers: [
    SellerService,
    SellerStoreService,
    SellerProductService,
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
  exports: [SellerService],
})
export class SellerModule {}
