/**
 * 3D 카탈로그 에셋(assets/custom-3d-catalog)을 미디어 버킷에 올린다. 배포 뒤 사람이 돌린다(infra/runbook.md).
 *   yarn catalog:upload --bucket <버킷> --dry-run   # 올릴 대상만
 *   yarn catalog:upload --bucket <버킷>
 * 같은 내용은 건너뛰고, 같은 경로에 다른 내용이 있으면 아무것도 올리지 않고 실패한다.
 */
import '@/config/preload-env';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

import {
  contentTypeOf,
  parseCatalogUploadArgs,
  planCatalogUpload,
} from './catalog-upload-plan';

import {
  catalogAssetPaths,
  CUSTOM_3D_ASSET_PREFIX,
} from '@/features/product/constants/custom-3d-catalog.constants';

const ASSET_ROOT = resolve(__dirname, '..', 'assets', CUSTOM_3D_ASSET_PREFIX);

async function remoteEtag(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return head.ETag ?? null;
  } catch (error) {
    // ListBucket 권한이 없으면 없는 객체가 403으로 온다
    const status =
      error instanceof S3ServiceException ? error.$metadata.httpStatusCode : 0;
    if (status === 404 || status === 403) return null;
    throw error;
  }
}

async function main(): Promise<void> {
  const { bucket, dryRun } = parseCatalogUploadArgs(process.argv.slice(2));
  const s3 = new S3Client({
    region: process.env.AWS_REGION?.trim() || 'ap-northeast-2',
  });
  // 카탈로그가 가리키는 파일 = 폴더의 파일(custom-3d-catalog.constants.spec이 양방향 대조)
  const files = catalogAssetPaths().map((relativePath) => {
    const path = join(ASSET_ROOT, relativePath);
    return {
      path,
      key: `${CUSTOM_3D_ASSET_PREFIX}/${relativePath}`,
      contentType: contentTypeOf(path),
      md5: createHash('md5').update(readFileSync(path)).digest('hex'),
    };
  });
  const etags = new Map<string, string | null>();
  for (const file of files) {
    etags.set(file.key, await remoteEtag(s3, bucket, file.key));
  }
  const keys = new Set(planCatalogUpload(files, etags).map((a) => a.key));
  const uploads = files.filter((file) => keys.has(file.key));
  process.stdout.write(
    `${bucket}: 에셋 ${files.length}개 중 업로드 ${uploads.length}개\n`,
  );
  if (dryRun) return;
  for (const file of uploads) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: file.key,
        Body: readFileSync(file.path),
        ContentType: file.contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    process.stdout.write(`  ${file.key}\n`);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
