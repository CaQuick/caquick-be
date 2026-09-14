import { Test } from '@nestjs/testing';

import {
  SELLER_UPLOAD_PURPOSES,
  type SellerUploadPurposeInput,
} from '@/features/seller/dto/inputs/seller-create-upload-url.input';
import { SellerUploadService } from '@/features/seller/services/seller-upload.service';
import {
  createS3ServiceMock,
  s3ServiceMockProvider,
  type S3ServiceMock,
} from '@/test/mocks/s3-service.mock';

// DB 불필요 — S3Service 위임만 검증한다.
describe('SellerUploadService', () => {
  let service: SellerUploadService;
  let s3: S3ServiceMock;

  beforeEach(async () => {
    s3 = createS3ServiceMock();
    const module = await Test.createTestingModule({
      providers: [SellerUploadService, s3ServiceMockProvider(s3)],
    }).compile();
    service = module.get(SellerUploadService);
    s3.createUploadUrl.mockResolvedValue({
      uploadUrl: 'https://s3/put',
      publicUrl: 'https://s3/public',
      key: 'k',
      expiresInSeconds: 600,
    });
  });

  it('S3Service.createUploadUrl에 계정과 입력을 그대로 넘긴다', async () => {
    const result = await service.sellerCreateUploadUrl(BigInt(7), {
      purpose: 'PRODUCT_IMAGE',
      contentType: 'image/png',
      contentLength: 2048,
    });

    expect(s3.createUploadUrl).toHaveBeenCalledWith({
      accountId: BigInt(7),
      purpose: 'PRODUCT_IMAGE',
      contentType: 'image/png',
      contentLength: 2048,
    });
    expect(result.publicUrl).toBe('https://s3/public');
  });

  // 허용 용도 전수 — DTO 화이트리스트가 늘면 여기도 늘어난다.
  it.each(SELLER_UPLOAD_PURPOSES)(
    '%s 용도를 그대로 전달한다',
    async (purpose: SellerUploadPurposeInput) => {
      await service.sellerCreateUploadUrl(BigInt(1), {
        purpose,
        contentType: 'image/jpeg',
        contentLength: 1,
      });

      expect(s3.createUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ purpose }),
      );
    },
  );
});
