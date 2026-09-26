export interface CategoryItem {
  id: string;
  name: string;
  categoryType: 'EVENT' | 'STYLE' | 'OTHER';
  sortOrder: number;
}
