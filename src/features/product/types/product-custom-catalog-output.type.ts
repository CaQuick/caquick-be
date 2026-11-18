import type {
  THREE_D_LIMITS,
  ThreeDDecoCategory,
  ThreeDEffect,
  ThreeDOptionCategory,
  ThreeDSheetColor,
} from '@/features/product/constants/custom-3d-catalog.constants';

export interface CustomThreeDOptionChoiceOutput {
  key: string;
  category: ThreeDOptionCategory;
  value: string;
  label: string;
  defaultPriceDelta: number;
  imageUrl: string | null;
  renderScale: number | null;
  selectable: boolean;
}

export interface CustomThreeDDecoOutput {
  key: string;
  category: string;
  label: string;
  imageUrl: string;
  selectable: boolean;
}

export interface CustomThreeDCatalogOutput {
  revision: number;
  designSchemaVersion: number;
  limits: typeof THREE_D_LIMITS;
  optionChoices: CustomThreeDOptionChoiceOutput[];
  sheetColors: readonly ThreeDSheetColor[];
  textColorPresets: readonly string[];
  defaultTextColor: string;
  effects: readonly ThreeDEffect[];
  decoCategories: readonly ThreeDDecoCategory[];
  decos: CustomThreeDDecoOutput[];
}
