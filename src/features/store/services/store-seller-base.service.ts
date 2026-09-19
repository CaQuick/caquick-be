import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import type { IAuditLogRepository } from '@/features/audit-log';
import {
  isSellerAccount,
  StoreSellerRepository,
} from '@/features/store/repositories/store-seller.repository';
import { Prisma } from '@/generated/prisma/client';

export interface SellerContext {
  accountId: bigint;
  storeId: bigint;
}

export abstract class SellerBaseService {
  protected constructor(
    protected readonly repo: StoreSellerRepository,
    protected readonly auditLogs: IAuditLogRepository,
  ) {}

  protected async requireSellerContext(
    accountId: bigint,
  ): Promise<SellerContext> {
    const account = await this.repo.findSellerAccountContext(accountId);
    if (!account) throw new DomainException('SESSION_ACCOUNT_MISSING');
    if (!isSellerAccount(account.account_type)) {
      throw new DomainException('SELLER_ONLY');
    }
    if (!account.store) {
      throw new DomainException('STORE_NOT_FOUND');
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
      throw new DomainException('DUPLICATE_IDS');
    }
    return parsed;
  }

  protected toTime(raw?: Date | string | null): Date | null {
    if (raw === undefined || raw === null) return null;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new DomainException('INVALID_TIME_VALUE');
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
      throw new DomainException('INVALID_DECIMAL_VALUE');
    }
  }

  protected cleanCurrency(raw?: string | null): string {
    const value = (raw ?? 'KRW').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(value)) {
      throw new DomainException('INVALID_CURRENCY_FORMAT');
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
      throw new DomainException('FIELD_OUT_OF_RANGE', { field, min, max });
    }
  }
}
