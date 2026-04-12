import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { STORAGE_ERRORS } from '@/global/storage/constants/storage.constants';
import { S3Service } from '@/global/storage/s3.service';

// getSignedUrl을 모킹
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com'),
}));

// S3Client를 모킹
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand: jest.fn().mockImplementation((input) => input),
}));

describe('S3Service', () => {
  let service: S3Service;

  const mockConfig = {
    region: 'ap-northeast-2',
    bucket: 'caquick-media-test',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    presignExpiresSeconds: 600,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(mockConfig) },
        },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
  });

  describe('createUploadUrl', () => {
    const baseInput = {
      accountId: BigInt(1),
      purpose: 'PROFILE_IMAGE' as const,
      contentType: 'image/jpeg',
      contentLength: 1024 * 1024, // 1MB
    };

    it('유효한 입력이면 Presigned URL을 반환해야 한다', async () => {
      const result = await service.createUploadUrl(baseInput);

      expect(result.uploadUrl).toBe('https://mock-presigned-url.com');
      expect(result.publicUrl).toContain('caquick-media-test');
      expect(result.publicUrl).toContain('profile-images/1/');
      expect(result.publicUrl).toEndWith('.jpg');
      expect(result.key).toContain('profile-images/1/');
      expect(result.expiresInSeconds).toBe(600);
    });

    it('key 형식이 {prefix}/{accountId}/{date}/{uuid}.{ext}여야 한다', async () => {
      const result = await service.createUploadUrl(baseInput);
      const keyPattern =
        /^profile-images\/1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.jpg$/;
      expect(result.key).toMatch(keyPattern);
    });

    it('publicUrl이 올바른 S3 URL 형식이어야 한다', async () => {
      const result = await service.createUploadUrl(baseInput);
      expect(result.publicUrl).toBe(
        `https://caquick-media-test.s3.ap-northeast-2.amazonaws.com/${result.key}`,
      );
    });

    describe('PROFILE_IMAGE purpose', () => {
      it('image/jpeg을 허용해야 한다', async () => {
        await expect(
          service.createUploadUrl({ ...baseInput, contentType: 'image/jpeg' }),
        ).resolves.toBeDefined();
      });

      it('image/png을 허용해야 한다', async () => {
        const result = await service.createUploadUrl({
          ...baseInput,
          contentType: 'image/png',
        });
        expect(result.key).toEndWith('.png');
      });

      it('image/webp을 허용해야 한다', async () => {
        const result = await service.createUploadUrl({
          ...baseInput,
          contentType: 'image/webp',
        });
        expect(result.key).toEndWith('.webp');
      });

      it('허용되지 않은 contentType이면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({ ...baseInput, contentType: 'image/gif' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('5MB 초과하면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...baseInput,
            contentLength: 6 * 1024 * 1024,
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('5MB 이하이면 허용해야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...baseInput,
            contentLength: 5 * 1024 * 1024,
          }),
        ).resolves.toBeDefined();
      });
    });

    describe('REVIEW_IMAGE purpose', () => {
      const reviewImageInput = {
        ...baseInput,
        purpose: 'REVIEW_IMAGE' as const,
      };

      it('10MB 이하이면 허용해야 한다', async () => {
        const result = await service.createUploadUrl({
          ...reviewImageInput,
          contentLength: 10 * 1024 * 1024,
        });
        expect(result.key).toContain('review-media/images/');
      });

      it('10MB 초과하면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...reviewImageInput,
            contentLength: 11 * 1024 * 1024,
          }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('REVIEW_VIDEO purpose', () => {
      const reviewVideoInput = {
        ...baseInput,
        purpose: 'REVIEW_VIDEO' as const,
        contentType: 'video/mp4',
      };

      it('video/mp4을 허용해야 한다', async () => {
        const result = await service.createUploadUrl(reviewVideoInput);
        expect(result.key).toContain('review-media/videos/');
        expect(result.key).toEndWith('.mp4');
      });

      it('video/quicktime을 허용해야 한다', async () => {
        const result = await service.createUploadUrl({
          ...reviewVideoInput,
          contentType: 'video/quicktime',
        });
        expect(result.key).toEndWith('.mov');
      });

      it('50MB 이하이면 허용해야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...reviewVideoInput,
            contentLength: 50 * 1024 * 1024,
          }),
        ).resolves.toBeDefined();
      });

      it('50MB 초과하면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...reviewVideoInput,
            contentLength: 51 * 1024 * 1024,
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('이미지 contentType이면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...reviewVideoInput,
            contentType: 'image/jpeg',
          }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('contentLength 검증', () => {
      it('0이면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({ ...baseInput, contentLength: 0 }),
        ).rejects.toThrow(STORAGE_ERRORS.INVALID_CONTENT_LENGTH);
      });

      it('음수이면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({ ...baseInput, contentLength: -1 }),
        ).rejects.toThrow(STORAGE_ERRORS.INVALID_CONTENT_LENGTH);
      });
    });

    describe('에러 메시지 검증', () => {
      it('허용되지 않은 contentType 에러에 허용 목록이 포함되어야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...baseInput,
            contentType: 'application/pdf',
          }),
        ).rejects.toThrow('허용되지 않은 파일 형식입니다.');
      });

      it('용량 초과 에러에 최대 크기가 포함되어야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...baseInput,
            contentLength: 100 * 1024 * 1024,
          }),
        ).rejects.toThrow('최대 5MB');
      });
    });

    describe('S3 presign 실패', () => {
      it('getSignedUrl 실패 시 BadRequestException을 던져야 한다', async () => {
        const { getSignedUrl: mockGetSignedUrl } = jest.requireMock<
          typeof import('@aws-sdk/s3-request-presigner')
        >('@aws-sdk/s3-request-presigner');
        (mockGetSignedUrl as jest.Mock).mockRejectedValueOnce(
          new Error('S3 error'),
        );

        await expect(service.createUploadUrl(baseInput)).rejects.toThrow(
          STORAGE_ERRORS.S3_PRESIGN_FAILED,
        );
      });
    });
  });
});

// Jest 커스텀 매처
expect.extend({
  toEndWith(received: string, suffix: string) {
    const pass = received.endsWith(suffix);
    return {
      pass,
      message: () =>
        `expected "${received}" ${pass ? 'not ' : ''}to end with "${suffix}"`,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toEndWith(suffix: string): R;
    }
  }
}
