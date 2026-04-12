import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { S3Config } from '@/config/s3.config';
import {
  STORAGE_ERRORS,
  UPLOAD_POLICIES,
} from '@/global/storage/constants/storage.constants';
import type {
  CreateUploadUrlInput,
  CreateUploadUrlOutput,
} from '@/global/storage/types/storage.types';

/**
 * Content-Type에서 확장자를 추출하는 맵
 */
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly presignExpiresSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<S3Config>('s3')!;

    this.bucket = config.bucket;
    this.region = config.region;
    this.presignExpiresSeconds = config.presignExpiresSeconds;

    this.client = new S3Client({
      region: config.region,
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  /**
   * Presigned PUT URL을 발급한다.
   *
   * 1. purpose별 정책(크기/타입) 검증
   * 2. S3 key 생성
   * 3. Presigned URL 발급
   */
  async createUploadUrl(
    input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlOutput> {
    const policy = UPLOAD_POLICIES[input.purpose];

    this.validateContentType(input.contentType, policy.allowedContentTypes);
    this.validateContentLength(input.contentLength, policy.maxSizeBytes);

    const key = this.buildKey(
      policy.keyPrefix,
      input.accountId,
      input.contentType,
    );

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });

    try {
      const uploadUrl = await getSignedUrl(this.client, command, {
        expiresIn: this.presignExpiresSeconds,
      });

      return {
        uploadUrl,
        publicUrl: this.buildPublicUrl(key),
        key,
        expiresInSeconds: this.presignExpiresSeconds,
      };
    } catch {
      throw new BadRequestException(STORAGE_ERRORS.S3_PRESIGN_FAILED);
    }
  }

  private validateContentType(
    contentType: string,
    allowedTypes: readonly string[],
  ): void {
    if (!allowedTypes.includes(contentType)) {
      throw new BadRequestException(
        `${STORAGE_ERRORS.INVALID_CONTENT_TYPE} (허용: ${allowedTypes.join(', ')})`,
      );
    }
  }

  private validateContentLength(
    contentLength: number,
    maxSizeBytes: number,
  ): void {
    if (contentLength <= 0) {
      throw new BadRequestException(STORAGE_ERRORS.INVALID_CONTENT_LENGTH);
    }
    if (contentLength > maxSizeBytes) {
      const maxMB = Math.round(maxSizeBytes / (1024 * 1024));
      throw new BadRequestException(
        `${STORAGE_ERRORS.FILE_TOO_LARGE} (최대 ${maxMB}MB)`,
      );
    }
  }

  /**
   * S3 key 생성 규칙: {prefix}/{accountId}/{yyyy-mm-dd}/{uuid}.{ext}
   */
  private buildKey(
    prefix: string,
    accountId: bigint,
    contentType: string,
  ): string {
    const date = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
    const uuid = randomUUID();
    const ext = CONTENT_TYPE_TO_EXT[contentType] ?? '.bin';
    return `${prefix}/${accountId.toString()}/${date}/${uuid}${ext}`;
  }

  private buildPublicUrl(key: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
