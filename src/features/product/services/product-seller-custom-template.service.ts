import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  BASE_IMAGE_SQUARE_TOLERANCE_PX,
  CUSTOM_AREA_SCALE,
  DEFAULT_TOKEN_MAX_LENGTH,
  MAX_TOKEN_DEFAULT_TEXT_LENGTH,
  MAX_TOKEN_LABEL_LENGTH,
  MAX_URL_LENGTH,
  TOKEN_KEY_PATTERN,
  TOKEN_MAX_LENGTH_RANGE,
} from '@/features/product/constants/product-seller.constants';
import type { SellerReorderProductCustomTextTokensInput } from '@/features/product/dto/inputs/seller-reorder-product-custom-text-tokens.input';
import type { SellerUpsertProductCustomTemplateInput } from '@/features/product/dto/inputs/seller-upsert-product-custom-template.input';
import type { SellerUpsertProductCustomTextTokenInput } from '@/features/product/dto/inputs/seller-upsert-product-custom-text-token.input';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { evaluateProductCustomIssues } from '@/features/product/services/product-custom-readiness.helper';
import {
  toCustomTemplateOutput,
  toCustomTextTokenOutput,
  toProductOutput,
} from '@/features/product/services/product-seller-mappers.helper';
import type {
  SellerCustomTemplateOutput,
  SellerCustomTextTokenOutput,
  SellerProductOutput,
} from '@/features/product/types/product-seller-output.type';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import {
  AuditActionType,
  AuditTargetType,
  type CustomMode,
} from '@/generated/prisma/client';
import { assertOwnedUploadUrl } from '@/global/storage/assert-owned-upload-url';
import { S3Service } from '@/global/storage/s3.service';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

@Injectable()
export class SellerCustomTemplateService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly productRepository: ProductRepository,
    private readonly s3: S3Service,
  ) {
    super(repo, auditLogs);
  }

  /** 같은 방식이면 그대로 돌려준다(감사 없음). 바꿀 방식에 준비 이슈가 있으면 CUSTOM_PRODUCT_NOT_READY. */
  async sellerSetProductCustomMode(
    accountId: bigint,
    productId: bigint,
    customMode: CustomMode,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const product = await this.requireOwnProduct(productId, ctx.storeId);
    if (product.custom_mode === customMode) return toProductOutput(product);

    if (evaluateProductCustomIssues(product, customMode).length > 0) {
      throw new DomainException('CUSTOM_PRODUCT_NOT_READY');
    }
    await this.productRepository.updateProduct(
      { productId, data: { custom_mode: customMode } },
      () => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: productId,
        action: AuditActionType.UPDATE,
        beforeJson: { customMode: product.custom_mode },
        afterJson: { customMode },
      }),
    );
    return toProductOutput(
      await this.requireOwnProduct(productId, ctx.storeId),
    );
  }

  async sellerUpsertProductCustomTemplate(
    accountId: bigint,
    input: SellerUpsertProductCustomTemplateInput,
  ): Promise<SellerCustomTemplateOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);
    const product = await this.requireOwnProduct(productId, ctx.storeId);

    const baseImageUrl = cleanRequiredText(input.baseImageUrl, MAX_URL_LENGTH);
    assertOwnedUploadUrl(
      this.s3,
      baseImageUrl,
      'PRODUCT_IMAGE',
      ctx.accountId,
      'INVALID_IMAGE_URL',
    );
    // 검증해 저장한 바탕은 다시 읽지 않는다 — 자유 편집만 바꿀 때 S3를 타지 않게
    if (product.custom_template?.base_image_url !== baseImageUrl) {
      await this.assertSquareBaseImage(baseImageUrl);
    }

    const row = await this.productRepository.upsertProductCustomTemplate(
      {
        productId,
        baseImageUrl,
        freeEditEnabled: input.freeEditEnabled ?? undefined,
      },
      (saved) => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: productId,
        action: AuditActionType.UPDATE,
        afterJson: {
          templateId: saved.id.toString(),
          baseImageUrl: saved.base_image_url,
          freeEditEnabled: saved.free_edit_enabled,
        },
      }),
    );
    return toCustomTemplateOutput(row);
  }

  async sellerUpsertProductCustomTextToken(
    accountId: bigint,
    input: SellerUpsertProductCustomTextTokenInput,
  ): Promise<SellerCustomTextTokenOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const templateId = parseId(input.templateId);
    const tokenId = input.tokenId ? parseId(input.tokenId) : undefined;

    const template =
      await this.productRepository.findCustomTemplateById(templateId);
    if (!template || template.product.store_id !== ctx.storeId) {
      throw new DomainException('CUSTOM_TEMPLATE_NOT_FOUND');
    }

    const existing = tokenId
      ? await this.productRepository.findCustomTextTokenById(tokenId)
      : null;
    if (
      tokenId &&
      (!existing ||
        existing.template.product.store_id !== ctx.storeId ||
        existing.template.id !== templateId)
    ) {
      throw new DomainException('CUSTOM_TEXT_TOKEN_NOT_FOUND');
    }

    const tokenKey = input.tokenKey.trim();
    // 형식 규칙 전에 만든 키는 바꾸지 않는 한 그대로 둔다
    if (tokenKey !== existing?.token_key && !TOKEN_KEY_PATTERN.test(tokenKey)) {
      throw new DomainException('CUSTOM_TOKEN_KEY_INVALID');
    }
    const label =
      input.label != null
        ? cleanRequiredText(input.label, MAX_TOKEN_LABEL_LENGTH)
        : (existing?.label ?? tokenKey.slice(0, MAX_TOKEN_LABEL_LENGTH));
    const maxLength = input.maxLength ?? DEFAULT_TOKEN_MAX_LENGTH;
    this.assertPositiveRange(
      maxLength,
      TOKEN_MAX_LENGTH_RANGE.min,
      TOKEN_MAX_LENGTH_RANGE.max,
      'maxLength',
    );
    const defaultText = cleanRequiredText(
      input.defaultText,
      MAX_TOKEN_DEFAULT_TEXT_LENGTH,
    );
    if ([...defaultText].length > maxLength) {
      throw new DomainException('CUSTOM_TEXT_DEFAULT_TOO_LONG', {
        label,
        max: maxLength,
      });
    }
    assertAreaInBounds(input);

    const row = await this.productRepository.upsertCustomTextToken(
      {
        tokenId,
        templateId,
        tokenKey,
        label,
        defaultText,
        maxLength,
        sortOrder: input.sortOrder ?? 0,
        isRequired: input.isRequired ?? true,
        posX: input.posX,
        posY: input.posY,
        width: input.width,
        height: input.height,
        textColor:
          input.textColor != null
            ? toUpperHexColor(input.textColor)
            : undefined,
        textAlign: input.textAlign ?? undefined,
      },
      (saved) => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: template.product_id,
        action: tokenId ? AuditActionType.UPDATE : AuditActionType.CREATE,
        afterJson: {
          tokenId: saved.id.toString(),
          tokenKey: saved.token_key,
        },
      }),
    );
    return toCustomTextTokenOutput(row);
  }

  async sellerDeleteProductCustomTextToken(
    accountId: bigint,
    tokenId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const token = await this.productRepository.findCustomTextTokenById(tokenId);
    if (!token || token.template.product.store_id !== ctx.storeId) {
      throw new DomainException('CUSTOM_TEXT_TOKEN_NOT_FOUND');
    }

    await this.productRepository.softDeleteCustomTextToken(tokenId, () => ({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: token.template.product_id,
      action: AuditActionType.DELETE,
      beforeJson: {
        tokenId: token.id.toString(),
        tokenKey: token.token_key,
      },
    }));
    return true;
  }

  async sellerReorderProductCustomTextTokens(
    accountId: bigint,
    input: SellerReorderProductCustomTextTokensInput,
  ): Promise<SellerCustomTextTokenOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const templateId = parseId(input.templateId);
    const tokenIds = this.parseIdList(input.tokenIds);

    const template =
      await this.productRepository.findCustomTemplateById(templateId);
    if (!template || template.product.store_id !== ctx.storeId) {
      throw new DomainException('CUSTOM_TEMPLATE_NOT_FOUND');
    }

    const tokens =
      await this.productRepository.listCustomTextTokens(templateId);
    if (tokens.length !== tokenIds.length) {
      throw new DomainException('IDS_LENGTH_MISMATCH', { field: 'tokenIds' });
    }

    const idSet = new Set(tokens.map((token) => token.id.toString()));
    for (const id of tokenIds) {
      if (!idSet.has(id.toString())) {
        throw new DomainException('INVALID_IDS', { field: 'tokenIds' });
      }
    }

    const rows = await this.productRepository.reorderCustomTextTokens(
      {
        templateId,
        tokenIds,
      },
      () => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: template.product_id,
        action: AuditActionType.UPDATE,
        afterJson: {
          tokenIds: tokenIds.map((id) => id.toString()),
        },
      }),
    );
    return rows.map(toCustomTextTokenOutput);
  }

  private async requireOwnProduct(productId: bigint, storeId: bigint) {
    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId,
      });
    if (!product) throw new DomainException('PRODUCT_NOT_FOUND');
    return product;
  }

  /** 문구 자리 좌표는 정사각 바탕을 전제로 한 비율이라 1:1을 서버가 강제한다. */
  private async assertSquareBaseImage(url: string): Promise<void> {
    const size = await this.s3.readImageSize(url);
    if (!size) throw new DomainException('CUSTOM_BASE_IMAGE_UNREADABLE');
    if (Math.abs(size.width - size.height) > BASE_IMAGE_SQUARE_TOLERANCE_PX) {
      throw new DomainException('CUSTOM_BASE_IMAGE_NOT_SQUARE');
    }
  }
}

function assertAreaInBounds(area: {
  posX: number;
  posY: number;
  width: number;
  height: number;
}): void {
  const fits = (start: number, length: number) =>
    start >= 0 && length >= 1 && start + length <= CUSTOM_AREA_SCALE;
  if (!fits(area.posX, area.width) || !fits(area.posY, area.height)) {
    throw new DomainException('CUSTOM_AREA_OUT_OF_BOUNDS');
  }
}

function toUpperHexColor(raw: string): string {
  const value = raw.trim();
  if (!HEX_COLOR.test(value)) throw new DomainException('INVALID_COLOR_FORMAT');
  return value.toUpperCase();
}
