import { Test, TestingModule } from '@nestjs/testing';

import { SellerService } from '../seller.service';

import { SellerMutationResolver } from './seller-mutation.resolver';
import { SellerQueryResolver } from './seller-query.resolver';

describe('SellerResolvers', () => {
  let queryResolver: SellerQueryResolver;
  let mutationResolver: SellerMutationResolver;
  let service: jest.Mocked<SellerService>;

  beforeEach(async () => {
    service = {
      sellerProduct: jest.fn(),
      sellerDeleteBanner: jest.fn(),
    } as unknown as jest.Mocked<SellerService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerQueryResolver,
        SellerMutationResolver,
        {
          provide: SellerService,
          useValue: service,
        },
      ],
    }).compile();

    queryResolver = module.get<SellerQueryResolver>(SellerQueryResolver);
    mutationResolver = module.get<SellerMutationResolver>(
      SellerMutationResolver,
    );
  });

  it('sellerProduct는 productId를 BigInt로 전달해야 한다', async () => {
    const user = { accountId: '11' };

    await queryResolver.sellerProduct(user, '123');

    expect(service.sellerProduct).toHaveBeenCalledWith(BigInt(11), BigInt(123));
  });

  it('sellerDeleteBanner는 bannerId를 BigInt로 전달해야 한다', async () => {
    const user = { accountId: '11' };

    await mutationResolver.sellerDeleteBanner(user, '77');

    expect(service.sellerDeleteBanner).toHaveBeenCalledWith(
      BigInt(11),
      BigInt(77),
    );
  });
});
