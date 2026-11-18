import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { codePointLength } from '@/common/utils/text-cleaner';
import { CUSTOM_UPLOAD_PURPOSES } from '@/features/order/constants/order-custom-upload-purposes';
import type {
  CreateOrderCustomInput,
  CreateOrderSlotCustomInput,
  CreateOrderThreeDCustomInput,
} from '@/features/order/dto/inputs/create-order-custom.input';
import type { OrderItemCustomSnapshot } from '@/features/order/repositories/order.repository';
import {
  CUSTOM_AREA_SCALE,
  evaluateProductCustomIssues,
  validateThreeDDesign,
  type ProductDetailRow,
} from '@/features/product';
import {
  CustomImageKind,
  CustomMode,
  OrderCustomUploadPurpose,
  type Prisma,
} from '@/generated/prisma/client';
import { assertOwnedUploadUrl } from '@/global/storage/assert-owned-upload-url';
import { S3Service } from '@/global/storage/s3.service';

const MAX_FREE_EDITS = 5;
const MAX_REFERENCE_IMAGES = 3;
const MAX_FREE_EDIT_DESCRIPTION_LENGTH = 2000;
const THREE_D_RENDER_KINDS = [
  CustomImageKind.THREE_D_TOP,
  CustomImageKind.THREE_D_FRONT,
  CustomImageKind.THREE_D_BACK,
  CustomImageKind.THREE_D_LEFT,
  CustomImageKind.THREE_D_RIGHT,
] as const;

type CustomDraft = Omit<OrderItemCustomSnapshot, 'uploads'>;
type SlotToken = NonNullable<
  ProductDetailRow['custom_template']
>['text_tokens'][number];

const normalizeText = (raw: string) => raw.replace(/\r\n?/g, '\n').trim();
const fits = (start: number, length: number) =>
  start >= 0 && length >= 1 && start + length <= CUSTOM_AREA_SCALE;
const freeEditInvalid = (field: string): never => {
  throw new DomainException('CUSTOM_FREE_EDIT_INVALID', { field });
};

@Injectable()
export class OrderCustomizationService {
  constructor(private readonly s3: S3Service) {}

  /**
   * 커스텀 입력을 주문 시점 상품 설정과 대조해 품목 스냅샷으로 만든다. 커스텀 상품이 아니면 null.
   * 가격은 건드리지 않는다 — 3D 모양·크기 등의 가격은 옵션 추가금으로만 들어온다.
   * selectedThreeDKeys는 고른 옵션 항목의 three_d_key다(3D와 무관한 항목은 null).
   */
  resolve(args: {
    product: ProductDetailRow;
    selectedThreeDKeys: readonly (string | null)[];
    quantity: number;
    custom: CreateOrderCustomInput | null | undefined;
    accountId: bigint;
  }): OrderItemCustomSnapshot | null {
    const { product } = args;
    const mode = product.custom_mode;
    const slot = args.custom?.slot ?? null;
    const threeD = args.custom?.threeD ?? null;
    if (mode === CustomMode.NONE) {
      if (slot || threeD) throw new DomainException('CUSTOM_INPUT_MISMATCH');
      return null;
    }
    if (!slot && !threeD) throw new DomainException('CUSTOM_INPUT_REQUIRED');
    const input =
      mode === CustomMode.SLOT && slot && !threeD
        ? { mode, slot }
        : mode === CustomMode.THREE_D && threeD && !slot
          ? { mode, threeD }
          : null;
    if (!input) throw new DomainException('CUSTOM_INPUT_MISMATCH');
    if (args.quantity !== 1) throw new DomainException('CUSTOM_QUANTITY_FIXED');
    if (evaluateProductCustomIssues(product, mode).length > 0) {
      throw new DomainException('CUSTOM_PRODUCT_NOT_READY');
    }

    const draft =
      input.mode === CustomMode.SLOT
        ? resolveSlot(product, input.slot)
        : resolveThreeD(input.threeD, args.selectedThreeDKeys);
    return { ...draft, uploads: this.toUploads(draft, args.accountId) };
  }

  /** 모든 이미지는 본인이 그 용도로 발급받은 업로드여야 하고, 한 주문 안에서 같은 파일을 두 번 쓸 수 없다. */
  private toUploads(
    draft: CustomDraft,
    accountId: bigint,
  ): OrderItemCustomSnapshot['uploads'] {
    const refs = [
      ...draft.images.map((image) => ({
        url: image.imageUrl,
        purpose:
          image.kind === CustomImageKind.SLOT_COMPOSITE
            ? OrderCustomUploadPurpose.COMPOSITE
            : OrderCustomUploadPurpose.RENDER,
      })),
      ...draft.freeEdits.flatMap((edit) =>
        edit.referenceImageUrls.map((url) => ({
          url,
          purpose: OrderCustomUploadPurpose.REFERENCE,
        })),
      ),
    ];
    const keys = new Set<string>();
    return refs.map(({ url, purpose }) => {
      assertOwnedUploadUrl(
        this.s3,
        url,
        CUSTOM_UPLOAD_PURPOSES[purpose],
        accountId,
        'CUSTOM_UPLOAD_INVALID',
      );
      // 쿼리·조각이 달라도 같은 객체다 — 중복은 키로 가린다
      const objectKey = new URL(url).pathname.slice(1);
      if (keys.has(objectKey)) {
        throw new DomainException('CUSTOM_UPLOAD_INVALID');
      }
      keys.add(objectKey);
      return { objectKey, purpose };
    });
  }
}

function resolveSlot(
  product: ProductDetailRow,
  slot: CreateOrderSlotCustomInput,
): CustomDraft {
  // 준비 상태를 통과했으면 살아 있는 템플릿이 있다
  const template = product.custom_template!;
  if (slot.templateRevision !== template.revision) {
    throw new DomainException('CUSTOM_TEMPLATE_CHANGED');
  }

  const valueByTokenId = new Map<bigint, string | null | undefined>();
  for (const text of slot.texts) {
    const tokenId = parseId(text.tokenId);
    if (valueByTokenId.has(tokenId)) {
      throw new DomainException('CUSTOM_SLOT_TEXTS_MISMATCH');
    }
    valueByTokenId.set(tokenId, text.valueText);
  }
  const tokens = template.text_tokens;
  if (
    valueByTokenId.size !== tokens.length ||
    tokens.some((token) => !valueByTokenId.has(token.id))
  ) {
    throw new DomainException('CUSTOM_SLOT_TEXTS_MISMATCH');
  }

  const texts = tokens.map((token) => ({
    tokenId: token.id,
    tokenKey: token.token_key,
    label: token.label,
    defaultText: token.default_text,
    valueText: slotValue(token, valueByTokenId.get(token.id)),
    sortOrder: token.sort_order,
    posX: token.pos_x,
    posY: token.pos_y,
    width: token.width,
    height: token.height,
    textColor: token.text_color,
    textAlign: token.text_align,
  }));

  const freeEdits = slot.freeEdits ?? [];
  if (
    (freeEdits.length > 0 && !template.free_edit_enabled) ||
    freeEdits.length > MAX_FREE_EDITS
  ) {
    freeEditInvalid('freeEdits');
  }

  return {
    mode: CustomMode.SLOT,
    baseImageUrl: template.base_image_url,
    previewImageUrl: slot.compositeImageUrl,
    texts,
    freeEdits: freeEdits.map((edit, index) => {
      const field = `freeEdits[${index}]`;
      if (!fits(edit.posX, edit.width) || !fits(edit.posY, edit.height)) {
        freeEditInvalid(field);
      }
      const description = normalizeText(edit.descriptionText);
      const length = codePointLength(description);
      if (length < 1 || length > MAX_FREE_EDIT_DESCRIPTION_LENGTH) {
        freeEditInvalid(`${field}.descriptionText`);
      }
      const urls = edit.referenceImageUrls ?? [];
      if (urls.length > MAX_REFERENCE_IMAGES) {
        freeEditInvalid(`${field}.referenceImageUrls`);
      }
      return {
        posX: edit.posX,
        posY: edit.posY,
        width: edit.width,
        height: edit.height,
        descriptionText: description,
        referenceImageUrls: [...urls],
      };
    }),
    design: null,
    images: [
      {
        kind: CustomImageKind.SLOT_COMPOSITE,
        imageUrl: slot.compositeImageUrl,
      },
    ],
  };
}

/** 지운 자리(빈 값)는 필수면 거절, 선택이면 '문구 없음'(null)이다. 길이는 코드 포인트로 센다. */
function slotValue(
  token: SlotToken,
  raw: string | null | undefined,
): string | null {
  const text = normalizeText(raw ?? '');
  if (!text) {
    if (token.is_required) {
      throw new DomainException('CUSTOM_SLOT_TEXT_REQUIRED', {
        label: token.label,
      });
    }
    return null;
  }
  if (codePointLength(text) > token.max_length) {
    throw new DomainException('CUSTOM_SLOT_TEXT_TOO_LONG', {
      label: token.label,
      max: token.max_length,
    });
  }
  return text;
}

function resolveThreeD(
  threeD: CreateOrderThreeDCustomInput,
  selectedThreeDKeys: readonly (string | null)[],
): CustomDraft {
  const design = validateThreeDDesign(threeD.design, selectedThreeDKeys);
  const urlByKind = new Map(
    threeD.renderImages.map((image) => [image.kind, image.imageUrl]),
  );
  // 다섯 종류가 모두 있고 개수도 다섯이면 종류마다 정확히 1장이다
  if (
    threeD.renderImages.length !== THREE_D_RENDER_KINDS.length ||
    THREE_D_RENDER_KINDS.some((kind) => !urlByKind.has(kind))
  ) {
    throw new DomainException('CUSTOM_RENDER_IMAGES_INVALID');
  }
  return {
    mode: CustomMode.THREE_D,
    baseImageUrl: null,
    previewImageUrl: urlByKind.get(CustomImageKind.THREE_D_TOP)!,
    texts: [],
    freeEdits: [],
    design: {
      schemaVersion: design.schemaVersion,
      // 검증된 정규형을 그대로 저장한다. 인터페이스라 Prisma JSON 인덱스 시그니처와 직접 맞지 않을 뿐이다
      json: design as unknown as Prisma.InputJsonObject,
    },
    images: THREE_D_RENDER_KINDS.map((kind) => ({
      kind,
      imageUrl: urlByKind.get(kind)!,
    })),
  };
}
