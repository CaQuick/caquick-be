/**
 * product-category resolver 반환용 도메인 출력 타입.
 * SDL(product-category.graphql)의 타입과 필드 일치.
 */

export interface CategoryItem {
  id: string;
  name: string;
  categoryType: 'EVENT' | 'STYLE' | 'OTHER';
  sortOrder: number;
}
