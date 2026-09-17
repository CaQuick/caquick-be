export interface ProductDetailOptionItem {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  priceDelta: number;
  sortOrder: number;
}

export interface ProductDetailOptionGroup {
  id: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  items: ProductDetailOptionItem[];
}

export interface ProductDetail {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  purchaseNotice: string | null;
  images: string[];
  regularPrice: number;
  salePrice: number | null;
  discountRate: number;
  currency: string;
  reviewCount: number;
  isWishlisted: boolean;
  optionGroups: ProductDetailOptionGroup[];
}
