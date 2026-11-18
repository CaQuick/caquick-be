import { Logger } from '@nestjs/common';

import type {
  ThreeDDesignItemOutput,
  ThreeDDesignOutput,
} from '@/features/order/types/order-output.type';
import { THREE_D_DESIGN_SCHEMA_VERSION } from '@/features/product';
import type { Prisma } from '@/generated/prisma/client';

const logger = new Logger('OrderCustomDesign');

type JsonObject = { [key: string]: Prisma.JsonValue | undefined };

const isObject = (v: unknown): v is JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isInteger = (v: unknown): v is number => Number.isInteger(v);
const nullableString = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : isString(v) ? v : undefined;

function parseItem(v: unknown): ThreeDDesignItemOutput | null {
  if (
    !isObject(v) ||
    !isNumber(v.x) ||
    !isNumber(v.y) ||
    !isNumber(v.size) ||
    !isObject(v.effect) ||
    !isString(v.effect.type) ||
    !isInteger(v.effect.intensity)
  )
    return null;
  const base = {
    x: v.x,
    y: v.y,
    size: v.size,
    effect: { type: v.effect.type, intensity: v.effect.intensity },
  };
  if (v.kind === 'TEXT' && isString(v.text) && isString(v.color))
    return {
      kind: 'TEXT',
      ...base,
      text: v.text,
      color: v.color,
      decoId: null,
    };
  if (v.kind === 'DECO' && isString(v.decoId))
    return { kind: 'DECO', ...base, text: null, color: null, decoId: v.decoId };
  return null;
}

function parseItems(v: unknown): ThreeDDesignItemOutput[] | null {
  if (!Array.isArray(v)) return null;
  const items = v.map(parseItem);
  return items.every((item) => item !== null) ? items : null;
}

function parseDesign(
  schemaVersion: number,
  json: Prisma.JsonValue,
): ThreeDDesignOutput | null {
  if (
    schemaVersion !== THREE_D_DESIGN_SCHEMA_VERSION ||
    !isObject(json) ||
    json.schemaVersion !== schemaVersion ||
    !isObject(json.basic)
  )
    return null;
  const { shape, size, sheetColor } = json.basic;
  const design = nullableString(json.basic.design);
  const flavor = nullableString(json.basic.flavor);
  const top = parseItems(json.top);
  const side = parseItems(json.side);
  if (
    !isString(shape) ||
    !isString(size) ||
    !isString(sheetColor) ||
    design === undefined ||
    flavor === undefined ||
    !top ||
    !side
  )
    return null;
  return {
    schemaVersion,
    basic: { shape, size, design, flavor, sheetColor },
    top,
    side,
  };
}

/**
 * 저장된 3D 디자인을 출력 형태로 읽는다. 저장 전 검증을 거친 값이지만 버전·형태가 어긋나면
 * 상세 전체를 실패시키지 않고 디자인만 null로 내리고 기록을 남긴다.
 */
export function readStoredThreeDDesign(
  orderItemId: bigint,
  row: { schema_version: number; design_json: Prisma.JsonValue } | null,
): ThreeDDesignOutput | null {
  if (!row) return null;
  const design = parseDesign(row.schema_version, row.design_json);
  if (!design) {
    logger.warn(
      `주문 3D 디자인을 읽을 수 없음 (orderItemId=${orderItemId}, schemaVersion=${row.schema_version})`,
    );
  }
  return design;
}
