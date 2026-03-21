import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import { ProductRepository } from '@/features/product';
import {
  CUSTOM_TEMPLATE_NOT_FOUND,
  CUSTOM_TEXT_TOKEN_NOT_FOUND,
  idsMismatchError,
  invalidIdsError,
  PRODUCT_NOT_FOUND,
} from '@/features/seller/constants/seller-error-messages';
import {
  DEFAULT_TOKEN_MAX_LENGTH,
  MAX_TOKEN_DEFAULT_TEXT_LENGTH,
  MAX_TOKEN_KEY_LENGTH,
  MAX_URL_LENGTH,
} from '@/features/seller/constants/seller.constants';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import type {
  SellerReorderProductCustomTextTokensInput,
  SellerSetProductCustomTemplateActiveInput,
  SellerUpsertProductCustomTemplateInput,
  SellerUpsertProductCustomTextTokenInput,
} from '@/features/seller/types/seller-input.type';
import type {
  SellerCustomTemplateOutput,
  SellerCustomTextTokenOutput,
} from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerCustomTemplateService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    private readonly productRepository: ProductRepository,
  ) {
    super(repo);
  }

  async sellerUpsertProductCustomTemplate(
    accountId: bigint,
    input: SellerUpsertProductCustomTemplateInput,
  ): Promise<SellerCustomTemplateOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);

    const row = await this.productRepository.upsertProductCustomTemplate({
      productId,
      baseImageUrl: cleanRequiredText(input.baseImageUrl, MAX_URL_LENGTH),
      isActive: input.isActive ?? true,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        templateId: row.id.toString(),
      },
    });

    return this.toCustomTemplateOutput(row);
  }

  async sellerSetProductCustomTemplateActive(
    accountId: bigint,
    input: SellerSetProductCustomTemplateActiveInput,
  ): Promise<SellerCustomTemplateOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const templateId = parseId(input.templateId);

    const template =
      await this.productRepository.findCustomTemplateById(templateId);
    if (!template || template.product.store_id !== ctx.storeId) {
      throw new NotFoundException(CUSTOM_TEMPLATE_NOT_FOUND);
    }

    const row = await this.productRepository.setCustomTemplateActive(
      templateId,
      input.isActive,
    );

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: template.product_id,
      action: AuditActionType.STATUS_CHANGE,
      afterJson: {
        templateId: row.id.toString(),
        isActive: row.is_active,
      },
    });

    return this.toCustomTemplateOutput(row);
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
      throw new NotFoundException(CUSTOM_TEMPLATE_NOT_FOUND);
    }

    if (tokenId) {
      const token =
        await this.productRepository.findCustomTextTokenById(tokenId);
      if (!token || token.template.product.store_id !== ctx.storeId) {
        throw new NotFoundException(CUSTOM_TEXT_TOKEN_NOT_FOUND);
      }
    }

    const row = await this.productRepository.upsertCustomTextToken({
      tokenId,
      templateId,
      tokenKey: cleanRequiredText(input.tokenKey, MAX_TOKEN_KEY_LENGTH),
      defaultText: cleanRequiredText(
        input.defaultText,
        MAX_TOKEN_DEFAULT_TEXT_LENGTH,
      ),
      maxLength: input.maxLength ?? DEFAULT_TOKEN_MAX_LENGTH,
      sortOrder: input.sortOrder ?? 0,
      isRequired: input.isRequired ?? true,
      posX: input.posX ?? null,
      posY: input.posY ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: template.product_id,
      action: tokenId ? AuditActionType.UPDATE : AuditActionType.CREATE,
      afterJson: {
        tokenId: row.id.toString(),
        tokenKey: row.token_key,
      },
    });

    return this.toCustomTextTokenOutput(row);
  }

  async sellerDeleteProductCustomTextToken(
    accountId: bigint,
    tokenId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const token = await this.productRepository.findCustomTextTokenById(tokenId);
    if (!token || token.template.product.store_id !== ctx.storeId) {
      throw new NotFoundException(CUSTOM_TEXT_TOKEN_NOT_FOUND);
    }

    await this.productRepository.softDeleteCustomTextToken(tokenId);
    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: token.template.product_id,
      action: AuditActionType.DELETE,
      beforeJson: {
        tokenId: token.id.toString(),
        tokenKey: token.token_key,
      },
    });

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
      throw new NotFoundException(CUSTOM_TEMPLATE_NOT_FOUND);
    }

    const tokens =
      await this.productRepository.listCustomTextTokens(templateId);
    if (tokens.length !== tokenIds.length) {
      throw new BadRequestException(idsMismatchError('tokenIds'));
    }

    const idSet = new Set(tokens.map((token) => token.id.toString()));
    for (const id of tokenIds) {
      if (!idSet.has(id.toString())) {
        throw new BadRequestException(invalidIdsError('tokenIds'));
      }
    }

    const rows = await this.productRepository.reorderCustomTextTokens({
      templateId,
      tokenIds,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: template.product_id,
      action: AuditActionType.UPDATE,
      afterJson: {
        tokenIds: tokenIds.map((id) => id.toString()),
      },
    });

    return rows.map((row) => this.toCustomTextTokenOutput(row));
  }

  private toCustomTemplateOutput(row: {
    id: bigint;
    product_id: bigint;
    base_image_url: string;
    is_active: boolean;
    text_tokens: {
      id: bigint;
      template_id: bigint;
      token_key: string;
      default_text: string;
      max_length: number;
      sort_order: number;
      is_required: boolean;
      pos_x: number | null;
      pos_y: number | null;
      width: number | null;
      height: number | null;
    }[];
  }): SellerCustomTemplateOutput {
    return {
      id: row.id.toString(),
      productId: row.product_id.toString(),
      baseImageUrl: row.base_image_url,
      isActive: row.is_active,
      textTokens: row.text_tokens.map((token) =>
        this.toCustomTextTokenOutput(token),
      ),
    };
  }

  private toCustomTextTokenOutput(row: {
    id: bigint;
    template_id: bigint;
    token_key: string;
    default_text: string;
    max_length: number;
    sort_order: number;
    is_required: boolean;
    pos_x: number | null;
    pos_y: number | null;
    width: number | null;
    height: number | null;
  }): SellerCustomTextTokenOutput {
    return {
      id: row.id.toString(),
      templateId: row.template_id.toString(),
      tokenKey: row.token_key,
      defaultText: row.default_text,
      maxLength: row.max_length,
      sortOrder: row.sort_order,
      isRequired: row.is_required,
      posX: row.pos_x,
      posY: row.pos_y,
      width: row.width,
      height: row.height,
    };
  }
}
