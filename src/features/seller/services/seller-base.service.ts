import { BadRequestException } from '@nestjs/common';

import { domainError } from '@/common/errors';
import { parseId } from '@/common/utils/id-parser';
import type { IAuditLogRepository } from '@/features/audit-log';
import { fieldRangeError } from '@/features/seller/constants/seller-error-messages';
import {
  isSellerAccount,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';
import { Prisma } from '@/generated/prisma/client';

export interface SellerContext {
  accountId: bigint;
  storeId: bigint;
}

export abstract class SellerBaseService {
  protected constructor(
    protected readonly repo: SellerRepository,
    protected readonly auditLogs: IAuditLogRepository,
  ) {}

  protected async requireSellerContext(
    accountId: bigint,
  ): Promise<SellerContext> {
    const account = await this.repo.findSellerAccountContext(accountId);
    if (!account) throw domainError('ACCOUNT_NOT_FOUND');
    if (!isSellerAccount(account.account_type)) {
      throw domainError('SELLER_ONLY');
    }
    if (!account.store) {
      throw domainError('STORE_NOT_FOUND');
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
      throw domainError('DUPLICATE_IDS');
    }
    return parsed;
  }

  protected toTime(raw?: Date | string | null): Date | null {
    if (raw === undefined || raw === null) return null;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw domainError('INVALID_TIME_VALUE');
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
      throw domainError('INVALID_DECIMAL_VALUE');
    }
  }

  protected cleanCurrency(raw?: string | null): string {
    const value = (raw ?? 'KRW').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(value)) {
      throw domainError('INVALID_CURRENCY_FORMAT');
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
