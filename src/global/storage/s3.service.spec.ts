import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { messageOf } from '@/common/errors';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { UPLOAD_POLICIES } from '@/global/storage/constants/storage.constants';
import { S3Service } from '@/global/storage/s3.service';
import type { UploadPurpose } from '@/global/storage/types/storage.types';

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
        ).rejects.toThrow(messageOf('INVALID_CONTENT_LENGTH'));
      });

      it('음수이면 거부해야 한다', async () => {
        await expect(
          service.createUploadUrl({ ...baseInput, contentLength: -1 }),
        ).rejects.toThrow(messageOf('INVALID_CONTENT_LENGTH'));
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
      it('getSignedUrl 실패 시 InternalServerErrorException을 던져야 한다', async () => {
        const { getSignedUrl: mockGetSignedUrl } = jest.requireMock<
          typeof import('@aws-sdk/s3-request-presigner')
        >('@aws-sdk/s3-request-presigner');
        (mockGetSignedUrl as jest.Mock).mockRejectedValueOnce(
          new Error('Credential is missing'),
        );

        await expect(service.createUploadUrl(baseInput)).rejects.toThrow(
          messageOf('S3_PRESIGN_FAILED'),
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
    const BUCKET_HOST = 'caquick-media-test.s3.ap-northeast-2.amazonaws.com';
    const OWNER = BigInt(1);

    // purpose 전수 표. UPLOAD_POLICIES에 항목이 늘면 여기에 줄을 추가한다
    // (누락되면 바로 아래 동기화 테스트가 깨진다).
    const PURPOSES = [
      { purpose: 'PROFILE_IMAGE', prefix: 'profile-images' },
      { purpose: 'REVIEW_IMAGE', prefix: 'review-media/images' },
      { purpose: 'REVIEW_VIDEO', prefix: 'review-media/videos' },
      { purpose: 'PRODUCT_IMAGE', prefix: 'product-images' },
      { purpose: 'STORE_IMAGE', prefix: 'store-images' },
      { purpose: 'BANNER_IMAGE', prefix: 'banner-images' },
    ] as const satisfies readonly { purpose: UploadPurpose; prefix: string }[];

    it('UPLOAD_POLICIES의 모든 purpose가 표에 있다', () => {
      expect([...PURPOSES].map((row) => row.purpose).sort()).toEqual(
        Object.keys(UPLOAD_POLICIES).sort(),
      );
    });

    it('표의 prefix가 UPLOAD_POLICIES와 일치한다', () => {
      for (const { purpose, prefix } of PURPOSES) {
        expect(UPLOAD_POLICIES[purpose].keyPrefix).toBe(prefix);
      }
    });

    describe.each(PURPOSES)('$purpose', ({ purpose, prefix }) => {
      it('이 버킷·해당 계정 prefix 의 URL 이면 true', () => {
        const url = `https://${BUCKET_HOST}/${prefix}/1/2026-06-10/abc.jpg`;
        expect(service.isOwnedUploadUrl(url, purpose, OWNER)).toBe(true);
      });

      // 거절 사유 전수. 새로운 우회 수법이 발견되면 이 표에 줄을 추가한다.
      it.each([
        {
          label: '다른 계정 prefix',
          url: () => `https://${BUCKET_HOST}/${prefix}/2/2026-06-10/abc.jpg`,
        },
        {
          label: '계정 id가 접두사만 같은 경우(10 vs 1)',
          url: () => `https://${BUCKET_HOST}/${prefix}/10/2026-06-10/abc.jpg`,
        },
        {
          label: '외부 도메인',
          url: () => `https://evil.example.com/${prefix}/1/x.jpg`,
        },
        {
          label: '다른 버킷',
          url: () =>
            `https://other-bucket.s3.ap-northeast-2.amazonaws.com/${prefix}/1/x.jpg`,
        },
        {
          label: '다른 리전',
          url: () =>
            `https://caquick-media-test.s3.us-east-1.amazonaws.com/${prefix}/1/x.jpg`,
        },
        {
          label: 'path traversal(../)로 타 계정 key 지시',
          url: () => `https://${BUCKET_HOST}/${prefix}/1/../2/x.jpg`,
        },
        {
          label: '인코딩된 dot(%2e)',
          url: () => `https://${BUCKET_HOST}/${prefix}/1/%2e%2e/2/x.jpg`,
        },
        {
          label: 'http(비 https)',
          url: () => `http://${BUCKET_HOST}/${prefix}/1/x.jpg`,
        },
        { label: 'URL 형식이 아님', url: () => 'not a url' },
        { label: '빈 문자열', url: () => '' },
      ])('$label 이면 false', ({ url }) => {
        expect(service.isOwnedUploadUrl(url(), purpose, OWNER)).toBe(false);
      });
    });

    // purpose를 섞으면 안 된다 — 리뷰 영상 key를 프로필 이미지로 저장하는 식의 교차 사용 차단.
    it.each(
      PURPOSES.flatMap((owner) =>
        PURPOSES.filter((other) => other.purpose !== owner.purpose).map(
          (other) => ({
            urlPurpose: other.purpose,
            urlPrefix: other.prefix,
            checkedAs: owner.purpose,
          }),
        ),
      ),
    )(
      '$urlPurpose prefix URL을 $checkedAs 로 검증하면 false',
      ({ urlPrefix, checkedAs }) => {
        const url = `https://${BUCKET_HOST}/${urlPrefix}/1/x.jpg`;
        expect(service.isOwnedUploadUrl(url, checkedAs, OWNER)).toBe(false);
      },
    );
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
