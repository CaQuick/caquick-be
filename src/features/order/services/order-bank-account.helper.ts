import { DomainException } from '@/common/errors/error-catalog';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import {
  MAX_ACCOUNT_HOLDER_LENGTH,
  PAYMENT_BANKS,
} from '@/features/order/constants/payment-banks';
import type { BankOutput } from '@/features/order/types/order-payment-output.type';

const BANK_NAMES: ReadonlyMap<string, string> = new Map(
  PAYMENT_BANKS.map((bank) => [bank.code, bank.name]),
);
const ACCOUNT_DIGITS = /^\d{8,20}$/;

export interface BankAccountInput {
  bankCode: string;
  accountHolder: string;
  accountNumber: string;
}

export function normalizeBankCode(raw: string): string {
  const code = raw.trim();
  if (!BANK_NAMES.has(code)) throw new DomainException('INVALID_BANK_CODE');
  return code;
}

/** 하이픈을 뺀 숫자 8~20자리. 저장·암호화는 숫자만 한다. */
export function normalizeAccountNumber(raw: string): string {
  const digits = raw.trim().replaceAll('-', '');
  if (!ACCOUNT_DIGITS.test(digits)) {
    throw new DomainException('INVALID_ACCOUNT_NUMBER');
  }
  return digits;
}

export function normalizeAccountHolder(raw: string): string {
  return cleanRequiredText(raw, MAX_ACCOUNT_HOLDER_LENGTH);
}

export function normalizeBankAccount(
  input: BankAccountInput,
): BankAccountInput {
  return {
    bankCode: normalizeBankCode(input.bankCode),
    accountHolder: normalizeAccountHolder(input.accountHolder),
    accountNumber: normalizeAccountNumber(input.accountNumber),
  };
}

/** 목록에서 빠진 옛 코드도 화면이 죽지 않게 코드를 이름으로 쓴다. */
export function toBank(code: string): BankOutput {
  return { code, name: BANK_NAMES.get(code) ?? code };
}

export function maskAccountNumber(last4: string): string {
  return `****${last4}`;
}
