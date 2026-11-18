import type { ThreeDOptionCategory } from '@/features/product/constants/custom-3d-catalog.constants';
import type { CustomMode, CustomTextAlign } from '@/generated/prisma/client';

export interface ProductDetailOptionItem {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  priceDelta: number;
  sortOrder: number;
  threeDKey: string | null;
}

export interface ProductDetailOptionGroup {
  id: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  threeDCategory: ThreeDOptionCategory | null;
  items: ProductDetailOptionItem[];
}

export interface ProductDetailCustomSlot {
  id: string;
  label: string;
  defaultText: string;
  maxLength: number;
  isRequired: boolean;
  posX: number;
  posY: number;
  width: number;
  height: number;
  textColor: string;
  textAlign: CustomTextAlign;
  sortOrder: number;
}

export interface ProductDetailCustomTemplate {
  revision: number;
  baseImageUrl: string;
  freeEditEnabled: boolean;
  slots: ProductDetailCustomSlot[];
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
  customMode: CustomMode;
  customTemplate: ProductDetailCustomTemplate | null;
}
