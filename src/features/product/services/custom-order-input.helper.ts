import type {
  ThreeDDesignItemSource,
  ThreeDDesignSource,
} from '@/features/product/services/three-d-design.helper';
import type { CustomImageKind } from '@/generated/prisma/client';

/**
 * 주문 생성의 커스텀 입력. order가 product를 import하므로 order DTO 타입을 여기서 import하면 순환이다 —
 * 구조 타입으로 받고 order DTO가 이 구조를 만족한다.
 */
export interface CustomOrderInputSource {
  slot?: {
    templateRevision: number;
    texts: readonly { tokenId: string; valueText?: string | null }[];
    compositeImageUrl: string;
    freeEdits?:
      | readonly {
          posX: number;
          posY: number;
          width: number;
          height: number;
          descriptionText: string;
          referenceImageUrls?: readonly string[] | null;
        }[]
      | null;
  } | null;
  threeD?: {
    design: ThreeDDesignSource;
    renderImages: readonly { kind: CustomImageKind; imageUrl: string }[];
  } | null;
}

const byText =
  <T>(key: (item: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

const item = (i: ThreeDDesignItemSource) => ({
  kind: i.kind,
  x: i.x,
  y: i.y,
  size: i.size,
  effect: { type: i.effect.type, intensity: i.effect.intensity },
  text: i.text,
  color: i.color,
  decoId: i.decoId,
});

/**
 * 입력 해시용 정규형. 순서가 의미 없는 배열(문구 자리·렌더 이미지)은 정렬하고 생략된 목록은 빈 배열로 둔다.
 * 그리는 순서·입력 순서가 의미인 배열(3D 항목·자유 편집·참고 사진)은 그대로 둔다. 슬롯·3D가 모두 없으면 null.
 */
export function canonicalizeCustomOrderInput(
  custom: CustomOrderInputSource,
): object | null {
  const { slot, threeD } = custom;
  if (!slot && !threeD) return null;
  return {
    slot: slot && {
      templateRevision: slot.templateRevision,
      texts: slot.texts
        .map((t) => ({ tokenId: t.tokenId, valueText: t.valueText }))
        .sort(byText((t) => t.tokenId)),
      compositeImageUrl: slot.compositeImageUrl,
      freeEdits: (slot.freeEdits ?? []).map((e) => ({
        posX: e.posX,
        posY: e.posY,
        width: e.width,
        height: e.height,
        descriptionText: e.descriptionText,
        referenceImageUrls: [...(e.referenceImageUrls ?? [])],
      })),
    },
    threeD: threeD && {
      design: {
        schemaVersion: threeD.design.schemaVersion,
        basic: {
          shape: threeD.design.basic.shape,
          size: threeD.design.basic.size,
          design: threeD.design.basic.design,
          flavor: threeD.design.basic.flavor,
          sheetColor: threeD.design.basic.sheetColor,
        },
        top: threeD.design.top.map(item),
        side: threeD.design.side.map(item),
      },
      renderImages: threeD.renderImages
        .map((r) => ({ kind: r.kind, imageUrl: r.imageUrl }))
        .sort(byText((r) => r.kind)),
    },
  };
}
