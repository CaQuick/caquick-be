import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
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
import { SellerUploadMutationResolver } from '@/features/seller/resolvers/seller-upload-mutation.resolver';
import { SellerAuditService } from '@/features/seller/services/seller-audit.service';
import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerFaqService } from '@/features/seller/services/seller-faq.service';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerOrderService } from '@/features/seller/services/seller-order.service';
import { SellerProductImageService } from '@/features/seller/services/seller-product-image.service';
import { SellerProductLifecycleService } from '@/features/seller/services/seller-product-lifecycle.service';
import { SellerProductQueryService } from '@/features/seller/services/seller-product-query.service';
import { SellerProductTaxonomyService } from '@/features/seller/services/seller-product-taxonomy.service';
import { SellerStoreHoursService } from '@/features/seller/services/seller-store-hours.service';
import { SellerStorePolicyService } from '@/features/seller/services/seller-store-policy.service';
import { SellerStoreProfileService } from '@/features/seller/services/seller-store-profile.service';
import { SellerUploadService } from '@/features/seller/services/seller-upload.service';

@Module({
  imports: [OrderModule, ProductModule, ConversationModule, AuditLogModule],
  providers: [
    SellerStoreProfileService,
    SellerStoreHoursService,
    SellerStorePolicyService,
    SellerProductQueryService,
    SellerProductLifecycleService,
    SellerProductImageService,
    SellerProductTaxonomyService,
    SellerOptionService,
    SellerCustomTemplateService,
    SellerOrderService,
    SellerConversationService,
    SellerUploadService,
    SellerFaqService,
    SellerAuditService,
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
    SellerUploadMutationResolver,
  ],
})
export class SellerModule {}
