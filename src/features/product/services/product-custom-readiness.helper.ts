import {
  findThreeDChoice,
  THREE_D_CATEGORY_LABELS,
  type ThreeDOptionCategory,
} from '@/features/product/constants/custom-3d-catalog.constants';
import { CustomMode } from '@/generated/prisma/client';

export type ProductCustomIssueCode =
  | 'SLOT_TEMPLATE_MISSING'
  | 'SLOT_NOTHING_TO_EDIT'
  | 'THREE_D_GROUP_MISSING'
  | 'THREE_D_GROUP_DUPLICATED'
  | 'THREE_D_GROUP_MIXED'
  | 'THREE_D_GROUP_NOT_SINGLE_SELECT'
  | 'THREE_D_KEY_DUPLICATED'
  | 'THREE_D_KEY_UNAVAILABLE';

export interface ProductCustomIssue {
  code: ProductCustomIssueCode;
  message: string;
  optionGroupId: string | null;
}

interface ThreeDKeyedItem {
  is_active: boolean;
  three_d_key: string | null;
}

export interface ProductCustomReadinessOptionGroup {
  id: bigint;
  is_active: boolean;
  is_required: boolean;
  min_select: number;
  max_select: number;
  option_items: readonly ThreeDKeyedItem[];
}

/** 준비 상태 판정에 필요한 만큼만 받는다. 문구 자리·옵션 그룹·항목은 삭제 제외 목록이어야 한다. */
export interface ProductCustomReadinessSource {
  custom_template: {
    deleted_at: Date | null;
    free_edit_enabled: boolean;
    text_tokens: readonly unknown[];
  } | null;
  option_groups: readonly ProductCustomReadinessOptionGroup[];
}

/** 모양·크기는 구매자가 꼭 하나 고른다. 맛·디자인은 고르지 않아도 된다(디자인이 없으면 장식 없는 시트). */
const REQUIRED_CATEGORIES: readonly ThreeDOptionCategory[] = ['SHAPE', 'SIZE'];

const issue = (
  code: ProductCustomIssueCode,
  message: string,
  optionGroupId: bigint | null = null,
): ProductCustomIssue => ({
  code,
  message,
  optionGroupId: optionGroupId?.toString() ?? null,
});

function categoriesOf(
  items: readonly ThreeDKeyedItem[],
): Set<ThreeDOptionCategory> {
  const categories = new Set<ThreeDOptionCategory>();
  for (const item of items) {
    const choice = item.is_active ? findThreeDChoice(item.three_d_key) : null;
    if (choice) categories.add(choice.category);
  }
  return categories;
}

/** 활성 선택지의 카탈로그 키가 한 카테고리로 모이면 그 값, 없거나 섞이면 null. */
export function threeDCategoryOf(group: {
  option_items: readonly ThreeDKeyedItem[];
}): ThreeDOptionCategory | null {
  const categories = categoriesOf(group.option_items);
  return categories.size === 1 ? [...categories][0] : null;
}

function evaluateThreeDIssues(
  groups: readonly ProductCustomReadinessOptionGroup[],
): ProductCustomIssue[] {
  const issues: ProductCustomIssue[] = [];
  const seenCategories = new Set<ThreeDOptionCategory>();
  const seenKeys = new Set<string>();

  for (const group of groups) {
    if (!group.is_active) continue;
    const items = group.option_items.filter((item) => item.is_active);
    const keys = items.flatMap((item) => item.three_d_key ?? []);
    if (keys.length === 0) continue; // 3D와 무관한 그룹(초 추가 등)

    if (keys.some((key) => !findThreeDChoice(key)?.selectable)) {
      issues.push(
        issue(
          'THREE_D_KEY_UNAVAILABLE',
          '더 이상 쓸 수 없는 3D 항목이 연결돼 있어요. 다른 항목으로 바꿔 주세요.',
          group.id,
        ),
      );
    }
    if (
      new Set(keys).size < keys.length ||
      keys.some((key) => seenKeys.has(key))
    ) {
      issues.push(
        issue(
          'THREE_D_KEY_DUPLICATED',
          '같은 3D 항목에 연결된 선택지가 둘 이상이에요.',
          group.id,
        ),
      );
    }
    keys.forEach((key) => seenKeys.add(key));

    const categories = categoriesOf(items);
    if (categories.size === 0) continue;
    if (categories.size > 1 || keys.length < items.length) {
      issues.push(
        issue(
          'THREE_D_GROUP_MIXED',
          '한 옵션 그룹의 선택지는 모두 같은 종류의 3D 항목에 연결해 주세요.',
          group.id,
        ),
      );
    }
    if (categories.size > 1) continue;

    const [category] = categories;
    const label = THREE_D_CATEGORY_LABELS[category];
    if (seenCategories.has(category)) {
      issues.push(
        issue(
          'THREE_D_GROUP_DUPLICATED',
          `${label} 3D 항목을 쓰는 옵션 그룹이 둘 이상이에요. 하나만 남겨 주세요.`,
          group.id,
        ),
      );
    }
    seenCategories.add(category);

    const required = REQUIRED_CATEGORIES.includes(category);
    const singleSelect = required
      ? group.is_required && group.min_select === 1 && group.max_select === 1
      : group.max_select === 1;
    if (!singleSelect) {
      issues.push(
        issue(
          'THREE_D_GROUP_NOT_SINGLE_SELECT',
          required
            ? `${label} 옵션은 필수, 1개 선택으로 설정해 주세요.`
            : `${label} 옵션은 최대 1개 선택으로 설정해 주세요.`,
          group.id,
        ),
      );
    }
  }

  const missing = REQUIRED_CATEGORIES.filter((c) => !seenCategories.has(c));
  return [
    ...missing.map((category) =>
      issue(
        'THREE_D_GROUP_MISSING',
        `${THREE_D_CATEGORY_LABELS[category]} 옵션을 만들고 3D 항목과 연결해 주세요.`,
      ),
    ),
    ...issues,
  ];
}

/** 판매자 방식 변경·준비 상태 경고·주문 생성이 같은 판정을 쓴다. 빈 배열이면 그 방식으로 주문을 받을 수 있다. */
export function evaluateProductCustomIssues(
  row: ProductCustomReadinessSource,
  mode: CustomMode,
): ProductCustomIssue[] {
  switch (mode) {
    case CustomMode.NONE:
      return [];
    case CustomMode.SLOT: {
      const template =
        row.custom_template?.deleted_at === null ? row.custom_template : null;
      if (!template) {
        return [
          issue('SLOT_TEMPLATE_MISSING', '바탕 이미지를 먼저 등록해 주세요.'),
        ];
      }
      return template.text_tokens.length === 0 && !template.free_edit_enabled
        ? [
            issue(
              'SLOT_NOTHING_TO_EDIT',
              '문구 자리를 추가하거나 자유 편집을 허용해 주세요.',
            ),
          ]
        : [];
    }
    case CustomMode.THREE_D:
      return evaluateThreeDIssues(row.option_groups);
  }
}
