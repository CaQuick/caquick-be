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
import { SellerProductMutationResolver } from '@/features/seller/resolvers/seller-product-mutation.resolver';
import { SellerProductQueryResolver } from '@/features/seller/resolvers/seller-product-query.resolver';
import { SellerUploadMutationResolver } from '@/features/seller/resolvers/seller-upload-mutation.resolver';
import { SellerAuditService } from '@/features/seller/services/seller-audit.service';
import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerOrderService } from '@/features/seller/services/seller-order.service';
import { SellerProductImageService } from '@/features/seller/services/seller-product-image.service';
import { SellerProductLifecycleService } from '@/features/seller/services/seller-product-lifecycle.service';
import { SellerProductQueryService } from '@/features/seller/services/seller-product-query.service';
import { SellerProductTaxonomyService } from '@/features/seller/services/seller-product-taxonomy.service';
import { SellerUploadService } from '@/features/seller/services/seller-upload.service';
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
    SellerProductQueryService,
    SellerProductLifecycleService,
    SellerProductImageService,
    SellerProductTaxonomyService,
    SellerOptionService,
    SellerCustomTemplateService,
    SellerOrderService,
    SellerConversationService,
    SellerUploadService,
    SellerAuditService,
    SellerRepository,
    SellerProductQueryResolver,
    SellerOrderQueryResolver,
    SellerConversationQueryResolver,
    SellerContentQueryResolver,
    SellerProductMutationResolver,
    SellerOrderMutationResolver,
    SellerConversationMutationResolver,
    SellerUploadMutationResolver,
  ],
})
export class SellerModule {}
