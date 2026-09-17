import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { UPLOAD_POLICIES } from '@/global/storage/constants/storage.constants';
import { S3Service } from '@/global/storage/s3.service';
import type { UploadPurpose } from '@/global/storage/types/storage.types';

export const TEST_S3_CONFIG = {
  region: 'ap-northeast-2',
  bucket: 'caquick-media-test',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  presignExpiresSeconds: 600,
};

/** URL 소유권 판정(isOwnedUploadUrl)은 네트워크 없이 동작하므로 mock 대신 실물을 태워 "발급된/외부 URL" 구분이 의미를 갖게 한다. presign이 필요한 spec은 aws-sdk를 별도로 mock 한다. */
export function s3TestProviders(): Provider[] {
  return [
    S3Service,
    { provide: ConfigService, useValue: { get: () => TEST_S3_CONFIG } },
    {
      provide: CustomLoggerService,
      useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    },
  ];
}

export function ownedUploadUrl(
  purpose: UploadPurpose,
  accountId: bigint,
  fileName = 'a.jpg',
): string {
  const { bucket, region } = TEST_S3_CONFIG;
  return `https://${bucket}.s3.${region}.amazonaws.com/${UPLOAD_POLICIES[purpose].keyPrefix}/${accountId.toString()}/2026-06-10/${fileName}`;
}

export const FOREIGN_UPLOAD_URL = 'https://evil.example.com/x.jpg';
