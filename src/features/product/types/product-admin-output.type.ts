import type {
  SellerCustomTemplateOutput,
  SellerOptionGroupOutput,
} from '@/features/product/types/product-seller-output.type';
import type {
  BannerLinkType,
  BannerPlacement,
  CategoryType,
} from '@/generated/prisma/client';

export interface AdminBannerOutput {
  id: string;
  placement: BannerPlacement;
  title: string | null;
  imageUrl: string;
  linkType: BannerLinkType;
  linkUrl: string | null;
  linkProductId: string | null;
  linkStoreId: string | null;
  linkCategoryId: string | null;
  linkTargetAvailable: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminProductOutput {
  id: string;
  storeId: string;
  storeName: string;
  storeIsActive: boolean;
  name: string;
  regularPrice: number;
  salePrice: number | null;
  currency: string;
  baseDesignImageUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminProductDetailOutput {
  product: AdminProductOutput;
  storeIsActive: boolean;
  description: string | null;
  purchaseNotice: string | null;
  preparationTimeMinutes: number;
  imageUrls: string[];
  reviewCount: number;
  orderItemCount: number;
  categories: AdminProductCategoryOutput[];
  tags: AdminProductTagOutput[];
  optionGroups: AdminProductOptionGroupOutput[];
  customTemplate: AdminProductCustomTemplateOutput | null;
}

export interface AdminProductCategoryOutput {
  id: string;
  categoryType: CategoryType;
  name: string;
  isActive: boolean;
}

export interface AdminProductTagOutput {
  id: string;
  name: string;
}

// 판매자 출력과 구조가 같다. SDL에 없는 필드(productId·좌표 등)는 GraphQL이 버린다.
export type AdminProductOptionGroupOutput = SellerOptionGroupOutput;
export type AdminProductCustomTemplateOutput = SellerCustomTemplateOutput;

export interface AdminCategoryOutput {
  id: string;
  categoryType: CategoryType;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminTagOutput {
  id: string;
  name: string;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}
