import { Injectable } from '@nestjs/common';

import {
  CUSTOM_3D_ASSET_PREFIX,
  CUSTOM_3D_CATALOG_REVISION,
  THREE_D_DECO_CATEGORIES,
  THREE_D_DECOS,
  THREE_D_DEFAULT_TEXT_COLOR,
  THREE_D_DESIGN_SCHEMA_VERSION,
  THREE_D_EFFECTS,
  THREE_D_LIMITS,
  THREE_D_OPTION_CHOICES,
  THREE_D_SHEET_COLORS,
  THREE_D_TEXT_COLOR_PRESETS,
} from '@/features/product/constants/custom-3d-catalog.constants';
import type { CustomThreeDCatalogOutput } from '@/features/product/types/product-custom-catalog-output.type';
import { S3Service } from '@/global/storage/s3.service';

/** 카탈로그는 코드 상수라 요청마다 같은 값이다. 에셋 URL은 이 환경 버킷 기준으로 한 번만 만든다. */
@Injectable()
export class ProductCustomCatalogService {
  private catalog: CustomThreeDCatalogOutput | null = null;

  constructor(private readonly s3: S3Service) {}

  customThreeDCatalog(): CustomThreeDCatalogOutput {
    this.catalog ??= this.build();
    return this.catalog;
  }

  private build(): CustomThreeDCatalogOutput {
    const assetUrl = (path: string) =>
      this.s3.publicUrlFor(`${CUSTOM_3D_ASSET_PREFIX}/${path}`);
    return {
      revision: CUSTOM_3D_CATALOG_REVISION,
      designSchemaVersion: THREE_D_DESIGN_SCHEMA_VERSION,
      limits: THREE_D_LIMITS,
      optionChoices: THREE_D_OPTION_CHOICES.map(({ imagePath, ...choice }) => ({
        ...choice,
        imageUrl: imagePath === null ? null : assetUrl(imagePath),
      })),
      sheetColors: THREE_D_SHEET_COLORS,
      textColorPresets: THREE_D_TEXT_COLOR_PRESETS,
      defaultTextColor: THREE_D_DEFAULT_TEXT_COLOR,
      effects: THREE_D_EFFECTS,
      decoCategories: THREE_D_DECO_CATEGORIES,
      decos: THREE_D_DECOS.map(({ imagePath, ...deco }) => ({
        ...deco,
        imageUrl: assetUrl(imagePath),
      })),
    };
  }
}
