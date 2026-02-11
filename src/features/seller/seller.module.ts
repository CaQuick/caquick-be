import { Module } from '@nestjs/common';

import { SellerRepository } from './repositories/seller.repository';
import { SellerMutationResolver } from './resolvers/seller-mutation.resolver';
import { SellerQueryResolver } from './resolvers/seller-query.resolver';
import { SellerService } from './seller.service';

@Module({
  providers: [
    SellerService,
    SellerRepository,
    SellerQueryResolver,
    SellerMutationResolver,
  ],
  exports: [SellerService],
})
export class SellerModule {}
