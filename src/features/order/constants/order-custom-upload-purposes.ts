import type { OrderCustomUploadPurpose } from '@/generated/prisma/client';
import type { UploadPurpose } from '@/global/storage/types/storage.types';

/** 구매자 커스텀 업로드 용도 → 저장소 정책(키 접두·형식·크기). 발급과 주문 생성의 소유 검증이 같은 표를 쓴다. */
export const CUSTOM_UPLOAD_PURPOSES = {
  RENDER: 'ORDER_CUSTOM_RENDER',
  COMPOSITE: 'ORDER_CUSTOM_COMPOSITE',
  REFERENCE: 'ORDER_CUSTOM_REFERENCE',
} as const satisfies Record<OrderCustomUploadPurpose, UploadPurpose>;
