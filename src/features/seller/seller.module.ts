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
import { SellerAuditService } from '@/features/seller/services/seller-audit.service';
import { SELLER_AUDIT_SERVICE } from '@/features/seller/services/seller-audit.service.interface';
import { SellerBannerService } from '@/features/seller/services/seller-banner.service';
import { SELLER_BANNER_SERVICE } from '@/features/seller/services/seller-banner.service.interface';
import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerFaqService } from '@/features/seller/services/seller-faq.service';
import { SELLER_FAQ_SERVICE } from '@/features/seller/services/seller-faq.service.interface';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerOrderService } from '@/features/seller/services/seller-order.service';
import { SellerProductImageService } from '@/features/seller/services/seller-product-image.service';
import { SELLER_PRODUCT_IMAGE_SERVICE } from '@/features/seller/services/seller-product-image.service.interface';
import { SellerProductLifecycleService } from '@/features/seller/services/seller-product-lifecycle.service';
import { SELLER_PRODUCT_LIFECYCLE_SERVICE } from '@/features/seller/services/seller-product-lifecycle.service.interface';
import { SellerProductQueryService } from '@/features/seller/services/seller-product-query.service';
import { SELLER_PRODUCT_QUERY_SERVICE } from '@/features/seller/services/seller-product-query.service.interface';
import { SellerProductTaxonomyService } from '@/features/seller/services/seller-product-taxonomy.service';
import { SELLER_PRODUCT_TAXONOMY_SERVICE } from '@/features/seller/services/seller-product-taxonomy.service.interface';
import { SellerStoreHoursService } from '@/features/seller/services/seller-store-hours.service';
import { SELLER_STORE_HOURS_SERVICE } from '@/features/seller/services/seller-store-hours.service.interface';
import { SellerStorePolicyService } from '@/features/seller/services/seller-store-policy.service';
import { SELLER_STORE_POLICY_SERVICE } from '@/features/seller/services/seller-store-policy.service.interface';
import { SellerStoreProfileService } from '@/features/seller/services/seller-store-profile.service';
import { SELLER_STORE_PROFILE_SERVICE } from '@/features/seller/services/seller-store-profile.service.interface';

@Module({
  imports: [OrderModule, ProductModule, ConversationModule, AuditLogModule],
  providers: [
    {
      provide: SELLER_STORE_PROFILE_SERVICE,
      useClass: SellerStoreProfileService,
    },
    {
      provide: SELLER_STORE_HOURS_SERVICE,
      useClass: SellerStoreHoursService,
    },
    {
      provide: SELLER_STORE_POLICY_SERVICE,
      useClass: SellerStorePolicyService,
    },
    {
      provide: SELLER_PRODUCT_QUERY_SERVICE,
      useClass: SellerProductQueryService,
    },
    {
      provide: SELLER_PRODUCT_LIFECYCLE_SERVICE,
      useClass: SellerProductLifecycleService,
    },
    {
      provide: SELLER_PRODUCT_IMAGE_SERVICE,
      useClass: SellerProductImageService,
    },
    {
      provide: SELLER_PRODUCT_TAXONOMY_SERVICE,
      useClass: SellerProductTaxonomyService,
    },
    SellerOptionService,
    SellerCustomTemplateService,
    SellerOrderService,
    SellerConversationService,
    {
      provide: SELLER_FAQ_SERVICE,
      useClass: SellerFaqService,
    },
    {
      provide: SELLER_BANNER_SERVICE,
      useClass: SellerBannerService,
    },
    {
      provide: SELLER_AUDIT_SERVICE,
      useClass: SellerAuditService,
    },
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
