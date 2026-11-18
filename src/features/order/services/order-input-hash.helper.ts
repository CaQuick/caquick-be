import { sha256Hex } from '@/common/utils/crypto';

export interface CreateOrderHashInput {
  productId: bigint;
  optionItemIds: bigint[];
  pickupAt: Date;
  quantity?: number | null;
  buyerName?: string | null;
  buyerPhone?: string | null;
  requestNote?: string | null;
  expectedTotalPrice: number;
}

/** 같은 멱등 키의 재요청이 같은 주문서인지 가린다. 옵션 순서·quantity 생략(= 1)·null 키에 흔들리지 않게 정규화한다. */
export function hashCreateOrderInput(input: CreateOrderHashInput): string {
  return sha256Hex(
    canonicalJson({
      productId: input.productId.toString(),
      optionItemIds: input.optionItemIds.map(String).sort(),
      pickupAt: input.pickupAt.toISOString(),
      quantity: input.quantity ?? 1,
      buyerName: input.buyerName,
      buyerPhone: input.buyerPhone,
      requestNote: input.requestNote,
      expectedTotalPrice: input.expectedTotalPrice,
    }),
  );
}

/** 객체 키를 정렬하고 null·undefined 키를 뺀 JSON. 배열은 순서가 의미라 그대로 둔다. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const fields = Object.entries(value)
      .filter(([, field]) => field !== null && field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}
