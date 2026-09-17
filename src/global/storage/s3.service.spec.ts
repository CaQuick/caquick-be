import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { CustomLoggerService } from '@/global/logger/custom-logger.service';
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

  const mockLogger = {
    error: jest.fn(),
  } as unknown as CustomLoggerService;

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
        { provide: CustomLoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
    (mockLogger.error as jest.Mock).mockClear();
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
        ).rejects.toThrowDomain(400);
      });

      it('5MB 초과하면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...baseInput,
            contentLength: 6 * 1024 * 1024,
          }),
        ).rejects.toThrowDomain(400);
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
        ).rejects.toThrowDomain(400);
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
        ).rejects.toThrowDomain(400);
      });

      it('이미지 contentType이면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...reviewVideoInput,
            contentType: 'image/jpeg',
          }),
        ).rejects.toThrowDomain(400);
      });
    });

    describe('contentLength 검증', () => {
      it('0이면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({ ...baseInput, contentLength: 0 }),
        ).rejects.toThrowDomain('INVALID_CONTENT_LENGTH');
      });

      it('음수이면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({ ...baseInput, contentLength: -1 }),
        ).rejects.toThrowDomain('INVALID_CONTENT_LENGTH');
      });
    });

    describe('에러 메시지 검증', () => {
      it('허용되지 않은 contentType 에러에 허용 목록이 포함되어야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...baseInput,
            contentType: 'application/pdf',
          }),
        ).rejects.toThrowDomain('INVALID_CONTENT_TYPE');
      });

      it('용량 초과 에러에 최대 크기가 포함되어야 한다', async () => {
        await expect(
          service.createUploadUrl({
            ...baseInput,
            contentLength: 100 * 1024 * 1024,
          }),
        ).rejects.toThrowDomain('FILE_TOO_LARGE');
      });
    });

    describe('S3 presign 실패', () => {
      it('getSignedUrl 실패 시 500을 던져야 한다', async () => {
        const { getSignedUrl: mockGetSignedUrl } = jest.requireMock<
          typeof import('@aws-sdk/s3-request-presigner')
        >('@aws-sdk/s3-request-presigner');
        (mockGetSignedUrl as jest.Mock).mockRejectedValueOnce(
          new Error('Credential is missing'),
        );

        await expect(service.createUploadUrl(baseInput)).rejects.toThrowDomain(
          'S3_PRESIGN_FAILED',
        );
        // 실제 원인이 구조화 로그로 남아야 한다 (일반 메시지로 가려지지 않도록)
        expect(mockLogger.error).toHaveBeenCalledWith(
          'S3 presigned URL 발급 실패',
          expect.objectContaining({
            cause: 'Error: Credential is missing',
            hasStaticCredentials: true,
          }),
        );
      });
    });
  });

  describe('생성자의 credentials 분기', () => {
    it('accessKeyId/secretAccessKey가 없으면 S3Client에 credentials 없이 초기화한다', async () => {
      const { S3Client: MockS3Client } =
        jest.requireMock<typeof import('@aws-sdk/client-s3')>(
          '@aws-sdk/client-s3',
        );
      (MockS3Client as jest.Mock).mockClear();

      const moduleRef: TestingModule = await Test.createTestingModule({
        providers: [
          S3Service,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue({
                region: 'ap-northeast-2',
                bucket: 'b',
                presignExpiresSeconds: 300,
                // accessKeyId, secretAccessKey 미지정
              }),
            },
          },
          { provide: CustomLoggerService, useValue: mockLogger },
        ],
      }).compile();

      moduleRef.get<S3Service>(S3Service);
      const lastCallArgs = (MockS3Client as jest.Mock).mock.calls.at(-1)?.[0];
      expect(lastCallArgs).toEqual({ region: 'ap-northeast-2' });
      // credentials 키 자체가 없어야 함 (ECS/EC2 IAM role 위임)
      expect(lastCallArgs?.credentials).toBeUndefined();
    });
  });

  describe('isOwnedUploadUrl', () => {
    const HOST = 'caquick-media-test.s3.ap-northeast-2.amazonaws.com';
    // purpose별 prefix와 "다른 purpose"의 prefix — 용도 교차 반증용
    const PURPOSES = [
      ['PROFILE_IMAGE', 'profile-images', 'review-media/images'],
      ['REVIEW_IMAGE', 'review-media/images', 'profile-images'],
      ['REVIEW_VIDEO', 'review-media/videos', 'review-media/images'],
    ] as const;

    describe.each(PURPOSES)('%s', (purpose, prefix, otherPrefix) => {
      it.each([
        [
          '이 버킷·계정·용도 prefix',
          `https://${HOST}/${prefix}/1/2026-06-10/a.jpg`,
          true,
        ],
        [
          '다른 계정 prefix',
          `https://${HOST}/${prefix}/2/2026-06-10/a.jpg`,
          false,
        ],
        ['다른 용도 prefix', `https://${HOST}/${otherPrefix}/1/a.jpg`, false],
        [
          '다른 버킷',
          `https://other.s3.ap-northeast-2.amazonaws.com/${prefix}/1/a.jpg`,
          false,
        ],
        [
          '다른 리전',
          `https://caquick-media-test.s3.us-east-1.amazonaws.com/${prefix}/1/a.jpg`,
          false,
        ],
        ['외부 도메인', `https://evil.example.com/${prefix}/1/a.jpg`, false],
        ['http', `http://${HOST}/${prefix}/1/a.jpg`, false],
        [
          'literal ../ traversal(정규화 후 타 계정)',
          `https://${HOST}/${prefix}/1/../2/a.jpg`,
          false,
        ],
        [
          '인코딩된 dot(%2e)',
          `https://${HOST}/${prefix}/1/%2e%2e/2/a.jpg`,
          false,
        ],
        ['URL 아님', 'not a url', false],
        ['빈 문자열', '', false],
      ])('%s → %s', (_label, url, expected) => {
        expect(service.isOwnedUploadUrl(url, purpose, BigInt(1))).toBe(
          expected,
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
