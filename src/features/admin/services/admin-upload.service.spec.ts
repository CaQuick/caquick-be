import { Test } from '@nestjs/testing';

import {
  ADMIN_UPLOAD_PURPOSES,
  type AdminUploadPurposeInput,
} from '@/features/admin/dto/inputs/admin-create-upload-url.input';
import { AdminUploadService } from '@/features/admin/services/admin-upload.service';
import {
  createS3ServiceMock,
  s3ServiceMockProvider,
  type S3ServiceMock,
} from '@/test/mocks/s3-service.mock';

// DB 불필요 — S3Service 위임만 검증한다.
describe('AdminUploadService', () => {
  let service: AdminUploadService;
  let s3: S3ServiceMock;

  beforeEach(async () => {
    s3 = createS3ServiceMock();
    const module = await Test.createTestingModule({
      providers: [AdminUploadService, s3ServiceMockProvider(s3)],
    }).compile();
    service = module.get(AdminUploadService);
    s3.createUploadUrl.mockResolvedValue({
      uploadUrl: 'https://s3/put',
      publicUrl: 'https://s3/public',
      key: 'k',
      expiresInSeconds: 600,
    });
  });

  it('S3Service.createUploadUrl에 계정과 입력을 그대로 넘긴다', async () => {
    const result = await service.adminCreateUploadUrl(BigInt(9), {
      purpose: 'BANNER_IMAGE',
      contentType: 'image/webp',
      contentLength: 4096,
    });

    expect(s3.createUploadUrl).toHaveBeenCalledWith({
      accountId: BigInt(9),
      purpose: 'BANNER_IMAGE',
      contentType: 'image/webp',
      contentLength: 4096,
    });
    expect(result.key).toBe('k');
  });

  it.each(ADMIN_UPLOAD_PURPOSES)(
    '%s 용도를 그대로 전달한다',
    async (purpose: AdminUploadPurposeInput) => {
      await service.adminCreateUploadUrl(BigInt(1), {
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
