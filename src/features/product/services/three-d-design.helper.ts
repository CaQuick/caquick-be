import { DomainException } from '@/common/errors/error-catalog';
import {
  findThreeDChoice,
  THREE_D_DECOS,
  THREE_D_DESIGN_SCHEMA_VERSION,
  THREE_D_EFFECTS,
  THREE_D_LIMITS,
  THREE_D_SHEET_COLORS,
  type ThreeDOptionCategory,
} from '@/features/product/constants/custom-3d-catalog.constants';

export type ThreeDItemKind = 'TEXT' | 'DECO';

/**
 * 주문 입력의 3D 디자인. order가 product를 import하므로 order DTO 타입을 여기서 import하면 순환이다 —
 * 구조 타입으로 받고 order DTO가 이 구조를 만족한다.
 */
export interface ThreeDDesignItemSource {
  kind: ThreeDItemKind;
  x: number;
  y: number;
  size: number;
  effect: { type: string; intensity: number };
  text?: string | null;
  color?: string | null;
  decoId?: string | null;
}

export interface ThreeDDesignSource {
  schemaVersion: number;
  basic: {
    shape: string;
    size: string;
    design?: string | null;
    flavor?: string | null;
    sheetColor: string;
  };
  top: readonly ThreeDDesignItemSource[];
  side: readonly ThreeDDesignItemSource[];
}

interface ThreeDDesignItemBase {
  x: number;
  y: number;
  size: number;
  effect: { type: string; intensity: number };
}

export type ThreeDDesignItemV1 =
  | (ThreeDDesignItemBase & { kind: 'TEXT'; text: string; color: string })
  | (ThreeDDesignItemBase & { kind: 'DECO'; decoId: string });

/** 주문에 저장하는 디자인 JSON v1. 배열 순서가 그리는 순서다. */
export interface ThreeDDesignV1 {
  schemaVersion: 1;
  basic: {
    shape: string;
    size: string;
    design: string | null;
    flavor: string | null;
    sheetColor: string;
  };
  top: ThreeDDesignItemV1[];
  side: ThreeDDesignItemV1[];
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const selectableKeys = (
  entries: readonly { key: string; selectable: boolean }[],
) => new Set(entries.filter((e) => e.selectable).map((e) => e.key));
const SHEET_COLOR_KEYS = selectableKeys(THREE_D_SHEET_COLORS);
const EFFECT_KEYS = selectableKeys(THREE_D_EFFECTS);
const DECO_KEYS = selectableKeys(THREE_D_DECOS);

const invalid = (field: string): never => {
  throw new DomainException('CUSTOM_3D_DESIGN_INVALID', { field });
};

/** 모양·크기는 고른 옵션의 값과 같아야 하고, 디자인·맛은 고른 항목이 없으면 null이어야 한다. */
function matchBasic(
  basic: ThreeDDesignSource['basic'],
  selectedThreeDKeys: readonly (string | null)[],
): ThreeDDesignV1['basic'] {
  const selected = new Map<ThreeDOptionCategory, string>();
  for (const key of selectedThreeDKeys) {
    const choice = findThreeDChoice(key);
    if (!choice) continue;
    if (selected.has(choice.category)) {
      throw new DomainException('CUSTOM_3D_OPTIONS_CHANGED');
    }
    selected.set(choice.category, choice.value);
  }
  const result = {
    shape: basic.shape,
    size: basic.size,
    design: basic.design ?? null,
    flavor: basic.flavor ?? null,
    sheetColor: basic.sheetColor,
  };
  if (
    result.shape !== selected.get('SHAPE') ||
    result.size !== selected.get('SIZE') ||
    result.design !== (selected.get('DESIGN') ?? null) ||
    result.flavor !== (selected.get('FLAVOR') ?? null)
  ) {
    throw new DomainException('CUSTOM_3D_OPTIONS_CHANGED');
  }
  return result;
}

function assertFaceLimits(items: readonly ThreeDDesignItemSource[]): void {
  const count = (kind: ThreeDItemKind) =>
    items.filter((item) => item.kind === kind).length;
  if (count('TEXT') > THREE_D_LIMITS.maxTextsPerFace) {
    throw new DomainException('CUSTOM_3D_ITEM_LIMIT_EXCEEDED', {
      max: THREE_D_LIMITS.maxTextsPerFace,
    });
  }
  if (count('DECO') > THREE_D_LIMITS.maxDecosPerFace) {
    throw new DomainException('CUSTOM_3D_ITEM_LIMIT_EXCEEDED', {
      max: THREE_D_LIMITS.maxDecosPerFace,
    });
  }
}

const inRange = (value: number, min: number, max: number) =>
  Number.isFinite(value) && value >= min && value <= max;

function toItem(
  item: ThreeDDesignItemSource,
  field: string,
): ThreeDDesignItemV1 {
  if (!inRange(item.x, 0, 1)) invalid(`${field}.x`);
  if (!inRange(item.y, 0, 1)) invalid(`${field}.y`);
  if (!EFFECT_KEYS.has(item.effect.type)) invalid(`${field}.effect.type`);
  const { intensity } = item.effect;
  if (
    !Number.isInteger(intensity) ||
    !inRange(
      intensity,
      THREE_D_LIMITS.effectIntensityMin,
      THREE_D_LIMITS.effectIntensityMax,
    )
  ) {
    invalid(`${field}.effect.intensity`);
  }
  const base = {
    x: item.x,
    y: item.y,
    size: item.size,
    effect: { type: item.effect.type, intensity },
  };

  if (item.kind === 'TEXT') {
    if (
      !inRange(
        item.size,
        THREE_D_LIMITS.textSizeMin,
        THREE_D_LIMITS.textSizeMax,
      )
    ) {
      invalid(`${field}.size`);
    }
    if (item.decoId != null) invalid(`${field}.decoId`);
    const text = (item.text ?? '').replace(/\r\n?/g, '\n').trim();
    const length = [...text].length;
    if (length < 1 || length > THREE_D_LIMITS.maxTextLength) {
      invalid(`${field}.text`);
    }
    if (!HEX_COLOR.test(item.color ?? '')) invalid(`${field}.color`);
    return { kind: 'TEXT', ...base, text, color: item.color!.toUpperCase() };
  }
  if (item.kind === 'DECO') {
    if (
      !inRange(
        item.size,
        THREE_D_LIMITS.decoSizeMin,
        THREE_D_LIMITS.decoSizeMax,
      )
    ) {
      invalid(`${field}.size`);
    }
    if (item.text != null) invalid(`${field}.text`);
    if (item.color != null) invalid(`${field}.color`);
    if (!DECO_KEYS.has(item.decoId ?? '')) invalid(`${field}.decoId`);
    return { kind: 'DECO', ...base, decoId: item.decoId! };
  }
  return invalid(`${field}.kind`);
}

/**
 * 주문할 3D 디자인을 카탈로그·한도로 검증하고 저장할 정규형(v1)으로 돌려준다.
 * selectedThreeDKeys는 구매자가 고른 옵션 항목의 three_d_key다(3D와 무관한 항목은 null).
 */
export function validateThreeDDesign(
  design: ThreeDDesignSource,
  selectedThreeDKeys: readonly (string | null)[],
): ThreeDDesignV1 {
  if (design.schemaVersion !== THREE_D_DESIGN_SCHEMA_VERSION) {
    throw new DomainException('CUSTOM_3D_SCHEMA_UNSUPPORTED');
  }
  const basic = matchBasic(design.basic, selectedThreeDKeys);
  assertFaceLimits(design.top);
  assertFaceLimits(design.side);
  if (!SHEET_COLOR_KEYS.has(basic.sheetColor)) invalid('basic.sheetColor');
  return {
    schemaVersion: THREE_D_DESIGN_SCHEMA_VERSION,
    basic,
    top: design.top.map((item, i) => toItem(item, `top[${i}]`)),
    side: design.side.map((item, i) => toItem(item, `side[${i}]`)),
  };
}
