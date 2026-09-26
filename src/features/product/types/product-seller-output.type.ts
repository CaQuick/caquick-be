export interface SellerCategoryOutput {
  id: string;
  name: string;
}

export interface SellerTagOutput {
  id: string;
  name: string;
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
}

export interface SellerOptionGroupOutput {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  optionRequiresDescription: boolean;
  optionRequiresImage: boolean;
  sortOrder: number;
  isActive: boolean;
  optionItems: SellerOptionItemOutput[];
}

export interface SellerCustomTextTokenOutput {
  id: string;
  templateId: string;
  tokenKey: string;
  defaultText: string;
  maxLength: number;
  sortOrder: number;
  isRequired: boolean;
  posX: number | null;
  posY: number | null;
  width: number | null;
  height: number | null;
}

export interface SellerCustomTemplateOutput {
  id: string;
  productId: string;
  baseImageUrl: string;
  isActive: boolean;
  textTokens: SellerCustomTextTokenOutput[];
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
  baseDesignImageUrl: string | null;
  preparationTimeMinutes: number;
  isActive: boolean;
  images: SellerProductImageOutput[];
  categories: SellerCategoryOutput[];
  tags: SellerTagOutput[];
  optionGroups: SellerOptionGroupOutput[];
  customTemplate: SellerCustomTemplateOutput | null;
  createdAt: Date;
  updatedAt: Date;
}
