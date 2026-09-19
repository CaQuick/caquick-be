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
}

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
