import { Test, TestingModule } from '@nestjs/testing';

import { SellerContentService } from '../services/seller-content.service';
import { SellerProductService } from '../services/seller-product.service';

import { SellerContentMutationResolver } from './seller-content-mutation.resolver';
import { SellerProductQueryResolver } from './seller-product-query.resolver';

describe('SellerResolvers', () => {
  let queryResolver: SellerProductQueryResolver;
  let mutationResolver: SellerContentMutationResolver;
  let productService: jest.Mocked<SellerProductService>;
  let contentService: jest.Mocked<SellerContentService>;

  beforeEach(async () => {
    productService = {
      sellerProduct: jest.fn(),
    } as unknown as jest.Mocked<SellerProductService>;

    contentService = {
      sellerDeleteBanner: jest.fn(),
    } as unknown as jest.Mocked<SellerContentService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerProductQueryResolver,
        SellerContentMutationResolver,
        {
          provide: SellerProductService,
          useValue: productService,
        },
        {
          provide: SellerContentService,
          useValue: contentService,
        },
      ],
    }).compile();

    queryResolver = module.get<SellerProductQueryResolver>(
      SellerProductQueryResolver,
    );
    mutationResolver = module.get<SellerContentMutationResolver>(
      SellerContentMutationResolver,
    );
  });

  it('sellerProduct는 productId를 BigInt로 전달해야 한다', async () => {
    const user = { accountId: '11' };

    await queryResolver.sellerProduct(user, '123');

    expect(productService.sellerProduct).toHaveBeenCalledWith(
      BigInt(11),
      BigInt(123),
    );
  });

  it('sellerDeleteBanner는 bannerId를 BigInt로 전달해야 한다', async () => {
    const user = { accountId: '11' };

    await mutationResolver.sellerDeleteBanner(user, '77');

    expect(contentService.sellerDeleteBanner).toHaveBeenCalledWith(
      BigInt(11),
      BigInt(77),
    );
  });
});
