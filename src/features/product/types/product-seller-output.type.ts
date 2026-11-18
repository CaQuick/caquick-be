import type { ThreeDOptionCategory } from '@/features/product/constants/custom-3d-catalog.constants';
import type { ProductCustomIssue } from '@/features/product/services/product-custom-readiness.helper';
import type { CustomMode, CustomTextAlign } from '@/generated/prisma/client';

export interface SellerCategoryOutput {
  id: string;
  name: string;
}

export interface SellerTagOutput {
  id: string;
  name: string;
}

export interface SellerTagSuggestionOutput {
  id: string;
  name: string;
  isExactMatch: boolean;
  productCount: number;
}

export interface SellerProductImageOutput {
  id: string;
  imageUrl: string;
  sortOrder: number;
}

export interface SellerOptionItemOutput {
  id: string;
  optionGroupId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  priceDelta: number;
  sortOrder: number;
  isActive: boolean;
  threeDKey: string | null;
}

export interface SellerOptionGroupOutput {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  threeDCategory: ThreeDOptionCategory | null;
  optionItems: SellerOptionItemOutput[];
}

export interface SellerCustomTextTokenOutput {
  id: string;
  templateId: string;
  tokenKey: string;
  label: string;
  defaultText: string;
  maxLength: number;
  sortOrder: number;
  isRequired: boolean;
  posX: number;
  posY: number;
  width: number;
  height: number;
  textColor: string;
  textAlign: CustomTextAlign;
}

export interface SellerCustomTemplateOutput {
  id: string;
  productId: string;
  baseImageUrl: string;
  freeEditEnabled: boolean;
  revision: number;
  textTokens: SellerCustomTextTokenOutput[];
}

export interface SellerCustomReadinessOutput {
  mode: CustomMode;
  ready: boolean;
  issues: ProductCustomIssue[];
}

export interface SellerProductOutput {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  purchaseNotice: string | null;
  regularPrice: number;
  salePrice: number | null;
  currency: string;
  preparationTimeMinutes: number;
  customMode: CustomMode;
  customReadiness: SellerCustomReadinessOutput[];
  isActive: boolean;
  images: SellerProductImageOutput[];
  categories: SellerCategoryOutput[];
  tags: SellerTagOutput[];
  optionGroups: SellerOptionGroupOutput[];
  customTemplate: SellerCustomTemplateOutput | null;
  createdAt: Date;
  updatedAt: Date;
}
