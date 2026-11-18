import {
  OrderCustomUploadPurpose,
  OrderCustomUploadStatus,
  Prisma,
} from '@/generated/prisma/client';

export interface CustomUploadRef {
  objectKey: string;
  purpose: OrderCustomUploadPurpose;
}

export type CustomUploadIssue = 'upload-invalid' | 'upload-expired';

/**
 * 주문에 붙일 업로드 행을 주문 tx 안에서 잠그고 검사한다. 잠근 행은 정리 크론(SKIP LOCKED)이 건너뛰므로
 * 검사와 ATTACHED 표시 사이에 지워지지 않는다. 발급 기록이 없거나 계정·용도가 다르거나 이미 다른 주문에 쓰였으면
 * 'upload-invalid', 정리 중이면 'upload-expired'.
 */
export async function lockCustomUploadsForAttach(
  tx: Prisma.TransactionClient,
  accountId: bigint,
  uploads: readonly CustomUploadRef[],
): Promise<CustomUploadIssue | null> {
  if (uploads.length === 0) return null;
  const rows = await tx.$queryRaw<
    {
      object_key: string;
      account_id: bigint;
      purpose: OrderCustomUploadPurpose;
      status: OrderCustomUploadStatus;
    }[]
  >`
    SELECT object_key, account_id, purpose, status FROM order_custom_upload
    WHERE object_key IN (${Prisma.join(uploads.map((u) => u.objectKey))})
    FOR UPDATE`;
  // 컬럼 콜레이션이 대소문자를 가리지 않아 IN이 다른 키를 함께 잡을 수 있다 — 키 비교는 여기서 정확히 한다
  const byKey = new Map(rows.map((row) => [row.object_key, row]));
  for (const upload of uploads) {
    const row = byKey.get(upload.objectKey);
    if (
      !row ||
      row.account_id !== accountId ||
      row.purpose !== upload.purpose ||
      row.status === OrderCustomUploadStatus.ATTACHED
    ) {
      return 'upload-invalid';
    }
    if (row.status === OrderCustomUploadStatus.PURGING) return 'upload-expired';
  }
  return null;
}

/** 주문된 파일은 정리 대상에서 빠진다. lockCustomUploadsForAttach로 잠근 같은 tx에서 부른다. */
export async function markCustomUploadsAttached(
  tx: Prisma.TransactionClient,
  uploads: readonly CustomUploadRef[],
  now: Date,
): Promise<void> {
  if (uploads.length === 0) return;
  await tx.orderCustomUpload.updateMany({
    where: {
      object_key: { in: uploads.map((u) => u.objectKey) },
      status: OrderCustomUploadStatus.PENDING,
    },
    data: { status: OrderCustomUploadStatus.ATTACHED, attached_at: now },
  });
}
