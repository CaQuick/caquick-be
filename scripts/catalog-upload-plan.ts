/** 인자·업로드 계획만 — spec이 S3 없이 검증할 수 있게 분리한다. */
export interface CatalogUploadArgs {
  bucket: string;
  dryRun: boolean;
}

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/** 버킷은 `--bucket <name>`으로만 받는다 — 기본값이 있으면 엉뚱한 환경에 올라간다. */
export function parseCatalogUploadArgs(argv: string[]): CatalogUploadArgs {
  let bucket: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--bucket' && BUCKET_NAME.test(argv[i + 1] ?? '')) {
      bucket = argv[(i += 1)];
    } else throw new Error(`알 수 없는 인자: ${argv[i]}`);
  }
  if (!bucket) throw new Error('--bucket <버킷 이름>이 필요합니다');
  return { bucket, dryRun };
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
};

export function contentTypeOf(path: string): string {
  const type = CONTENT_TYPES[path.slice(path.lastIndexOf('.'))];
  if (!type) throw new Error(`올릴 수 없는 에셋 형식: ${path}`);
  return type;
}

export interface CatalogAsset {
  key: string;
  md5: string;
}

/**
 * 같은 key에 같은 내용(ETag = MD5)이면 건너뛴다. 다른 내용이 이미 있으면 아무것도 올리지 않고 던진다 —
 * 에셋은 immutable로 캐시되고 과거 주문이 같은 모습으로 그려져야 하므로, 바꿀 때는 새 경로로 더한다.
 */
export function planCatalogUpload(
  assets: CatalogAsset[],
  remoteEtags: ReadonlyMap<string, string | null>,
): CatalogAsset[] {
  const changed = assets.filter((asset) => {
    const etag = remoteEtags.get(asset.key);
    return etag != null && etag.replaceAll('"', '') !== asset.md5;
  });
  if (changed.length > 0) {
    throw new Error(
      `이미 다른 내용이 올라가 있습니다(덮어쓰지 않음): ${changed.map((a) => a.key).join(', ')}`,
    );
  }
  return assets.filter((asset) => remoteEtags.get(asset.key) == null);
}
