import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainException } from '@/common/errors/error-catalog';
import type { S3Config } from '@/config/s3.config';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { UPLOAD_POLICIES } from '@/global/storage/constants/storage.constants';
import type {
  CreateUploadUrlInput,
  CreateUploadUrlOutput,
  UploadPurpose,
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
  // presign 실패 진단용: 정적 자격증명(Access Key) 주입 여부.
  // 로컬에서 키 누락이면 getSignedUrl이 "Credential is missing"으로 throw된다.
  private readonly hasStaticCredentials: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: CustomLoggerService,
  ) {
    const config = this.configService.get<S3Config>('s3')!;

    this.bucket = config.bucket;
    this.region = config.region;
    this.presignExpiresSeconds = config.presignExpiresSeconds;
    this.hasStaticCredentials = Boolean(
      config.accessKeyId && config.secretAccessKey,
    );

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
    } catch (error) {
      // 실제 실패 원인(예: 자격증명 누락 "Credential is missing")이 일반 메시지에
      // 가려지지 않도록 구조화 로그로 남긴다. 시크릿(키 값)은 절대 로깅하지 않는다.
      this.logger.error('S3 presigned URL 발급 실패', {
        bucket: this.bucket,
        region: this.region,
        key,
        purpose: input.purpose,
        hasStaticCredentials: this.hasStaticCredentials,
        cause:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      });
      throw new DomainException('S3_PRESIGN_FAILED');
    }
  }

  /**
   * 주어진 URL이 이 버킷에서 해당 계정·purpose로 발급된 publicUrl인지 검증한다.
   * 클라이언트가 임의 URL(외부 링크·타인 key·다른 용도 key)을 저장하는 것을 막는다.
   *
   * raw `startsWith` 비교는 path traversal(`/profile-images/1/../2/...`)로 우회 가능하므로
   * URL을 파싱해 host·protocol과 정규화된 pathname을 검증하고, 인코딩된 dot(`%2e`)은 거절한다.
   */
  isOwnedUploadUrl(
    url: string,
    purpose: UploadPurpose,
    accountId: bigint,
  ): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    // literal `../`는 new URL이 정규화하므로 prefix 검사에서 걸리지만 `%2e`는 정규화되지 않는다.
    if (/%2e/i.test(parsed.pathname)) return false;

    const expectedHost = `${this.bucket}.s3.${this.region}.amazonaws.com`;
    const expectedPathPrefix = `/${UPLOAD_POLICIES[purpose].keyPrefix}/${accountId.toString()}/`;

    return (
      parsed.protocol === 'https:' &&
      parsed.host === expectedHost &&
      parsed.pathname.startsWith(expectedPathPrefix)
    );
  }

  private validateContentType(
    contentType: string,
    allowedTypes: readonly string[],
  ): void {
    if (!allowedTypes.includes(contentType)) {
      throw new DomainException('INVALID_CONTENT_TYPE', {
        allowed: allowedTypes.join(', '),
      });
    }
  }

  private validateContentLength(
    contentLength: number,
    maxSizeBytes: number,
  ): void {
    if (contentLength <= 0) {
      throw new DomainException('INVALID_CONTENT_LENGTH');
    }
    if (contentLength > maxSizeBytes) {
      const maxMB = Math.round(maxSizeBytes / (1024 * 1024));
      throw new DomainException('FILE_TOO_LARGE', { maxMb: maxMB });
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
