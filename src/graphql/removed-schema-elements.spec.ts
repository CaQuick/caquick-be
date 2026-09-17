import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildSchema,
  type GraphQLSchema,
  isNonNullType,
  isObjectType,
} from 'graphql';

/**
 * Phase 0에서 의도적으로 삭제한 SDL 요소가 되살아나지 않게 고정한다.
 * 앱과 같은 범위(src/features/**\/*.graphql)를 통째로 빌드하므로 파일 단위 파싱이 놓치는
 * 타입 소실·중복 정의도 여기서 걸린다. 삭제 PR마다 표에 줄을 추가한다.
 */
const REMOVED_OUTPUT_FIELDS: Array<[type: string, field: string, pr: string]> =
  [
    ['MyPageCounts', 'customDraftCount', '플랜 03'],
    ['MyPageCounts', 'couponCount', '플랜 03'],
    ['ViewerCounts', 'cartItemCount', '플랜 03'],
  ];
const REMOVED_TYPES: Array<[type: string, pr: string]> = [
  ['SellerCursorInput', '플랜 06'],
  ['AdminCursorInput', '플랜 06'],
  ['SellerConversationListInput', '플랜 06'],
  ['MyConversationsInput', '플랜 06'],
  ['ConversationMessagesInput', '플랜 06'],
  ['StorePickupCalendar', '플랜 08'],
  ['StorePickupDay', '플랜 08'],
  ['StorePickupTimeSlots', '플랜 08'],
  ['StorePickupSlot', '플랜 08'],
  ['ProductReviewMedia', '플랜 09'],
  ['StoreReviewMedia', '플랜 09'],
  ['MyReviewMedia', '플랜 09'],
];
const REMOVED_ROOT_FIELDS: Array<
  [root: 'Query' | 'Mutation', field: string, pr: string]
> = [
  ['Query', 'storePickupCalendar', '플랜 08'],
  ['Query', 'storePickupTimeSlots', '플랜 08'],
];
// 개명된 매장판 루트 필드는 storeId를 필수로 받는다 — 전역판(인자 없음)이 같은 이름으로 되살아나지 않게.
const REQUIRED_ROOT_ARGS: Array<
  [root: 'Query' | 'Mutation', field: string, arg: string, pr: string]
> = [
  ['Query', 'pickupCalendar', 'storeId', '플랜 08'],
  ['Query', 'pickupTimeSlots', 'storeId', '플랜 08'],
];

// 검사기 반증용 — 실제로 존재하는 요소. 검사가 "없음"만 통과시키는 게 아니라 "있음"을 구분하는지 본다.
const PRESENT_OUTPUT_FIELD: [string, string] = [
  'MyPageCounts',
  'wishlistCount',
];
const PRESENT_TYPE = 'MyPageCounts';
const PRESENT_ROOT_FIELD: ['Query', string] = ['Query', 'myPageOverview'];

function collectSdl(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectSdl(full);
    return entry.name.endsWith('.graphql') ? [readFileSync(full, 'utf8')] : [];
  });
}

function hasOutputField(
  schema: GraphQLSchema,
  type: string,
  field: string,
): boolean {
  const t = schema.getType(type);
  return isObjectType(t) && field in t.getFields();
}

describe('삭제된 스키마 요소 부재 (전체 SDL 빌드)', () => {
  const schema = buildSchema(
    collectSdl(join(process.cwd(), 'src/features')).join('\n'),
  );

  it('검사기는 존재하는 요소를 있음으로 판정한다 (반증)', () => {
    expect(hasOutputField(schema, ...PRESENT_OUTPUT_FIELD)).toBe(true);
    expect(schema.getType(PRESENT_TYPE)).toBeDefined();
    expect(
      hasOutputField(schema, PRESENT_ROOT_FIELD[0], PRESENT_ROOT_FIELD[1]),
    ).toBe(true);
  });

  // jest의 it.each는 빈 표를 거부하므로 루프로 등록한다 — 아직 삭제 항목이 없는 종류는 케이스 0개로 둔다.
  for (const [type, field, pr] of REMOVED_OUTPUT_FIELDS) {
    it(`${type}.${field} 필드는 없다 (${pr})`, () => {
      expect(hasOutputField(schema, type, field)).toBe(false);
    });
  }

  for (const [type, pr] of REMOVED_TYPES) {
    it(`${type} 타입은 없다 (${pr})`, () => {
      expect(schema.getType(type)).toBeUndefined();
    });
  }

  for (const [root, field, pr] of REMOVED_ROOT_FIELDS) {
    it(`${root}.${field} 루트 필드는 없다 (${pr})`, () => {
      expect(hasOutputField(schema, root, field)).toBe(false);
    });
  }

  for (const [root, field, arg, pr] of REQUIRED_ROOT_ARGS) {
    it(`${root}.${field}의 ${arg} 인자는 필수다 (${pr})`, () => {
      const t = schema.getType(root);
      const f = isObjectType(t) ? t.getFields()[field] : undefined;
      const a = f?.args.find((x) => x.name === arg);
      expect(a !== undefined && isNonNullType(a.type)).toBe(true);
    });
  }
});
