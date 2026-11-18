import {
  THREE_D_CATEGORY_LABELS,
  THREE_D_OPTION_CATEGORIES,
  THREE_D_OPTION_CHOICES,
  type ThreeDOptionCategory,
} from '@/features/product/constants/custom-3d-catalog.constants';
import type { NewOptionGroup } from '@/features/product/repositories/product.repository';
import { threeDCategoryOf } from '@/features/product/services/product-custom-readiness.helper';

/** 디자인은 고르지 않아도 되는 그룹으로 만든다. 매장이 필수로 바꿀 수 있다. */
const OPTIONAL_PRESET_CATEGORIES: readonly ThreeDOptionCategory[] = ['DESIGN'];

/**
 * 활성 그룹이 차지하지 않은 카테고리마다 단일 선택 그룹을 계획한다. 준비 상태 판정과 같은 그룹 기준이라
 * 기본 세트를 불러온 뒤에는 모양·크기 누락이 사라지고, 다시 불러도 아무것도 만들지 않는다.
 */
export function planThreeDOptionPreset(
  groups: readonly {
    is_active: boolean;
    option_items: readonly { is_active: boolean; three_d_key: string | null }[];
  }[],
): NewOptionGroup[] {
  const taken = new Set(
    groups.filter((g) => g.is_active).map((g) => threeDCategoryOf(g)),
  );
  return THREE_D_OPTION_CATEGORIES.filter((c) => !taken.has(c)).map(
    (category) => {
      const required = !OPTIONAL_PRESET_CATEGORIES.includes(category);
      return {
        name: THREE_D_CATEGORY_LABELS[category],
        is_required: required,
        min_select: required ? 1 : 0,
        max_select: 1,
        items: THREE_D_OPTION_CHOICES.filter(
          (c) => c.category === category && c.selectable,
        ).map((c) => ({
          title: c.label,
          price_delta: c.defaultPriceDelta,
          three_d_key: c.key,
        })),
      };
    },
  );
}
