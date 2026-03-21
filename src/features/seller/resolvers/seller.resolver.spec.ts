import { Test, TestingModule } from '@nestjs/testing';

import { SellerContentMutationResolver } from '@/features/seller/resolvers/seller-content-mutation.resolver';
import { SellerProductMutationResolver } from '@/features/seller/resolvers/seller-product-mutation.resolver';
import { SellerProductQueryResolver } from '@/features/seller/resolvers/seller-product-query.resolver';
import { SellerContentService } from '@/features/seller/services/seller-content.service';
import { SellerCustomTemplateService } from '@/features/seller/services/seller-custom-template.service';
import { SellerOptionService } from '@/features/seller/services/seller-option.service';
import { SellerProductCrudService } from '@/features/seller/services/seller-product-crud.service';

describe('SellerResolvers', () => {
  let queryResolver: SellerProductQueryResolver;
  let mutationResolver: SellerContentMutationResolver;
  let productService: jest.Mocked<SellerProductCrudService>;
  let contentService: jest.Mocked<SellerContentService>;
  let optionService: jest.Mocked<SellerOptionService>;
  let templateService: jest.Mocked<SellerCustomTemplateService>;

  beforeEach(async () => {
    productService = {
      sellerProduct: jest.fn(),
    } as unknown as jest.Mocked<SellerProductCrudService>;

    contentService = {
      sellerDeleteBanner: jest.fn(),
    } as unknown as jest.Mocked<SellerContentService>;

    optionService = {} as unknown as jest.Mocked<SellerOptionService>;
    templateService = {} as unknown as jest.Mocked<SellerCustomTemplateService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerProductQueryResolver,
        SellerProductMutationResolver,
        SellerContentMutationResolver,
        {
          provide: SellerProductCrudService,
          useValue: productService,
        },
        {
          provide: SellerContentService,
          useValue: contentService,
        },
        {
          provide: SellerOptionService,
          useValue: optionService,
        },
        {
          provide: SellerCustomTemplateService,
          useValue: templateService,
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
