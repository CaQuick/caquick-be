import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { parseId } from '@/common/utils/id-parser';
import {
  ACCOUNT_NOT_FOUND,
  DUPLICATE_IDS,
  fieldRangeError,
  INVALID_CURRENCY_FORMAT,
  INVALID_DECIMAL_VALUE,
  INVALID_TIME_VALUE,
  SELLER_ONLY,
  STORE_NOT_FOUND,
} from '@/features/seller/constants/seller-error-messages';
import {
  isSellerAccount,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';

export interface SellerContext {
  accountId: bigint;
  storeId: bigint;
}

export abstract class SellerBaseService {
  protected constructor(protected readonly repo: SellerRepository) {}

  protected async requireSellerContext(
    accountId: bigint,
  ): Promise<SellerContext> {
    const account = await this.repo.findSellerAccountContext(accountId);
    if (!account) throw new UnauthorizedException(ACCOUNT_NOT_FOUND);
    if (!isSellerAccount(account.account_type)) {
      throw new ForbiddenException(SELLER_ONLY);
    }
    if (!account.store) {
      throw new NotFoundException(STORE_NOT_FOUND);
    }

    return {
      accountId: account.id,
      storeId: account.store.id,
    };
  }

  protected parseIdList(rawIds: string[]): bigint[] {
    const parsed = rawIds.map((id) => parseId(id));
    const set = new Set(parsed.map((id) => id.toString()));
    if (set.size !== parsed.length) {
      throw new BadRequestException(DUPLICATE_IDS);
    }
    return parsed;
  }

  protected toTime(raw?: Date | string | null): Date | null {
    if (raw === undefined || raw === null) return null;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(INVALID_TIME_VALUE);
    }
    return date;
  }

  protected toDecimal(raw?: string | null): Prisma.Decimal | null {
    if (raw === undefined || raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
      return new Prisma.Decimal(trimmed);
    } catch {
      throw new BadRequestException(INVALID_DECIMAL_VALUE);
    }
  }

  protected cleanCurrency(raw?: string | null): string {
    const value = (raw ?? 'KRW').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(value)) {
      throw new BadRequestException(INVALID_CURRENCY_FORMAT);
    }
    return value;
  }

  protected assertPositiveRange(
    value: number,
    min: number,
    max: number,
    field: string,
  ): void {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(fieldRangeError(field, min, max));
    }
  }
}
