import { randomUUID } from 'node:crypto';

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { imageSize } from 'image-size';

import { DomainException } from '@/common/errors/error-catalog';
import type { S3Config } from '@/config/s3.config';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { UPLOAD_POLICIES } from '@/global/storage/constants/storage.constants';
import type {
  CreateUploadUrlInput,
  CreateUploadUrlOutput,
  ImageDimensions,
  UploadPurpose,
} from '@/global/storage/types/storage.types';

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

/** 크기 헤더는 대개 앞부분에 있다. JPEG은 EXIF·ICC 세그먼트가 길면 SOF가 이보다 뒤에 올 수 있어 전체를 다시 읽는다. */
const IMAGE_HEADER_BYTES = 64 * 1024;
/** 객체가 없거나(404) 0바이트라 범위를 못 읽는(416) 경우는 장애가 아니라 읽을 수 없는 이미지다. */
const UNREADABLE_OBJECT_STATUS = new Set([404, 416]);
/** DeleteObjects 요청 1건의 키 상한. */
const DELETE_OBJECTS_MAX_KEYS = 1000;

export interface DeleteObjectsFailure {
  key: string;
  code: string;
}

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly presignExpiresSeconds: number;
  // presign 실패 진단용 — 로컬에서 키 누락이면 getSignedUrl이 "Credential is missing"으로 throw된다.
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
        publicUrl: this.publicUrlFor(key),
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
   * 클라이언트가 임의 URL(외부 링크·타인 key·다른 용도 key)을 저장하는 것을 막는다. raw startsWith 비교는
   * path traversal(`/profile-images/1/../2/...`)로 우회 가능하므로 URL을 파싱해 host·protocol과 정규화된
   * pathname을 검증하고, 인코딩된 dot(`%2e`)은 거절한다.
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

  /**
   * 이 버킷의 공개 URL이 가리키는 이미지의 가로·세로(px)를 헤더만 읽어 구한다. 이미지가 아니거나 객체가 없으면 null,
   * S3 호출 자체가 실패하면 S3_READ_FAILED다. 호출부가 URL 소유를 먼저 검증한다(403을 없는 객체로 보는 전제).
   */
  async readImageSize(url: string): Promise<ImageDimensions | null> {
    const key = this.keyOfPublicUrl(url);
    if (key === null) return null;

    const head = await this.readObject(
      key,
      `bytes=0-${IMAGE_HEADER_BYTES - 1}`,
    );
    if (head === null) return null;
    const size = measureImage(head.bytes);
    if (size !== null || head.bytes.length >= head.totalBytes) return size;

    const full = await this.readObject(key);
    return full === null ? null : measureImage(full.bytes);
  }

  /**
   * 이 버킷의 객체를 지운다(요청당 1000개). 없는 객체는 S3가 지운 것으로 답한다. 키별 실패와 요청 자체의 실패를
   * 모두 실패 목록으로 돌려주고 던지지 않는다 — 호출부가 지워진 키만 골라 기록을 정리한다.
   */
  async deleteObjects(
    keys: readonly string[],
  ): Promise<DeleteObjectsFailure[]> {
    const failures: DeleteObjectsFailure[] = [];
    for (let i = 0; i < keys.length; i += DELETE_OBJECTS_MAX_KEYS) {
      const chunk = keys.slice(i, i + DELETE_OBJECTS_MAX_KEYS);
      try {
        const res = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        for (const error of res.Errors ?? []) {
          failures.push({
            key: error.Key ?? '',
            code: error.Code ?? 'Unknown',
          });
        }
      } catch (error) {
        const code = error instanceof Error ? error.name : 'Unknown';
        this.logger.error('S3 객체 삭제 실패', {
          bucket: this.bucket,
          keys: chunk.length,
          cause:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
        });
        failures.push(...chunk.map((key) => ({ key, code })));
      }
    }
    return failures;
  }

  private keyOfPublicUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const expectedHost = `${this.bucket}.s3.${this.region}.amazonaws.com`;
      return parsed.host === expectedHost
        ? decodeURIComponent(parsed.pathname.slice(1))
        : null;
    } catch {
      return null;
    }
  }

  private async readObject(
    key: string,
    range?: string,
  ): Promise<{ bytes: Uint8Array; totalBytes: number } | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }),
      );
      const bytes =
        (await res.Body?.transformToByteArray()) ?? new Uint8Array();
      // ContentRange: "bytes 0-65535/1234567" — 범위 요청이 아니면 받은 바이트가 전체다
      const total = Number(res.ContentRange?.split('/')[1]);
      return {
        bytes,
        totalBytes: Number.isFinite(total) ? total : bytes.length,
      };
    } catch (error) {
      if (error instanceof S3ServiceException) {
        const status = error.$metadata.httpStatusCode ?? 0;
        if (UNREADABLE_OBJECT_STATUS.has(status)) return null;
        // 앱에 ListBucket 권한이 없어 S3는 없는 키를 404 대신 403 AccessDenied로 준다.
        // 권한이 빠진 경우와 구별할 수 없어 경고는 남긴다.
        if (status === 403 && error.name === 'AccessDenied') {
          this.logger.warn('S3 객체 접근 거부 — 없는 객체로 본다', {
            bucket: this.bucket,
            key,
          });
          return null;
        }
      }
      this.logger.error('S3 객체 읽기 실패', {
        bucket: this.bucket,
        key,
        cause:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      });
      throw new DomainException('S3_READ_FAILED');
    }
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

  /** 이 버킷 객체의 공개 URL. 버킷 정책이 전체 공개 읽기라 업로드 외 고정 에셋(3D 카탈로그)도 이 주소로 연다. */
  publicUrlFor(key: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}

function measureImage(bytes: Uint8Array): ImageDimensions | null {
  try {
    const { width, height } = imageSize(bytes);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null;
  }
}
