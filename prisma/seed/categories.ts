/**
 * 카테고리(Category) 마스터 시드.
 *
 * figma Category_Entry 스펙(spec/*.md) 목록을 정본으로 한다.
 * - 이벤트별 16종 + 스타일별 7종. sort_order는 스펙 나열 순.
 * - '전체' 칩은 카테고리가 아니라 FE 가상 칩(필터 미적용)이라 시드하지 않는다.
 * - 카테고리는 영구 마스터이므로 resetSeedScope 정리 대상이 아니다(region과 동일).
 *   uk(category_type, name) 기준 upsert로 항상 최신 상태로 보정한다.
 */
import type { CategoryType, PrismaClient } from '@prisma/client';

const EVENT_CATEGORY_NAMES = [
  '생일',
  '돌잔치',
  '크리스마스',
  '연인',
  '우정',
  '스승의날',
  '합격/승진',
  '웨딩',
  '부모님',
  '반려동물',
  '신년',
  '감사',
  '개업/오픈',
  '졸업',
  '위로/응원',
  '기타',
] as const;

const STYLE_CATEGORY_NAMES = [
  '꽃장식',
  '돈장식',
  '입체',
  '티아라',
  '포토',
  '도시락',
  '그림일기',
] as const;

export interface SeededCategories {
  /** `${category_type}:${name}` → id */
  idByTypeName: Map<string, bigint>;
}

export async function seedCategories(
  prisma: PrismaClient,
): Promise<SeededCategories> {
  const idByTypeName = new Map<string, bigint>();

  const upsertAll = async (
    type: CategoryType,
    names: readonly string[],
  ): Promise<void> => {
    for (const [index, name] of names.entries()) {
      const category = await prisma.category.upsert({
        where: {
          category_type_name: { category_type: type, name },
        },
        create: {
          category_type: type,
          name,
          sort_order: index,
        },
        update: {
          sort_order: index,
          is_active: true,
          deleted_at: null,
        },
      });
      idByTypeName.set(`${type}:${name}`, category.id);
    }
  };

  await upsertAll('EVENT', EVENT_CATEGORY_NAMES);
  await upsertAll('STYLE', STYLE_CATEGORY_NAMES);

  return { idByTypeName };
}
