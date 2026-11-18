import { PAYMENT_BANKS } from '@/features/order/constants/payment-banks';
import {
  maskAccountNumber,
  normalizeAccountHolder,
  normalizeAccountNumber,
  normalizeBankAccount,
  normalizeBankCode,
  toBank,
} from '@/features/order/services/order-bank-account.helper';

describe('order-bank-account.helper', () => {
  describe('은행 코드', () => {
    it('목록은 금융결제원 3자리 코드이고 겹치지 않는다', () => {
      const codes = PAYMENT_BANKS.map((bank) => bank.code);
      expect(codes.length).toBeGreaterThan(20);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes.every((code) => /^\d{3}$/.test(code))).toBe(true);
    });

    it.each(PAYMENT_BANKS.map((bank) => bank.code))('%s는 통과한다', (code) => {
      expect(normalizeBankCode(` ${code} `)).toBe(code);
    });

    it.each(['', '4', '04', '0004', '999', 'abc', '０04'])(
      '반증: "%s"는 INVALID_BANK_CODE',
      (code) => {
        expect(() => normalizeBankCode(code)).toThrowDomain(
          'INVALID_BANK_CODE',
        );
      },
    );
  });

  describe('계좌번호', () => {
    it.each([
      ['8자리', '12345678', '12345678'],
      ['20자리', '1'.repeat(20), '1'.repeat(20)],
      ['하이픈 제거', '110-123-456789', '110123456789'],
      ['앞뒤 공백', ' 1234-5678 ', '12345678'],
    ])('%s: 숫자만 남긴다', (_label, raw, expected) => {
      expect(normalizeAccountNumber(raw)).toBe(expected);
    });

    it.each([
      ['7자리', '1234567'],
      ['21자리', '1'.repeat(21)],
      ['하이픈 제거 뒤 7자리', '123-4567'],
      ['가운데 공백', '1234 5678'],
      ['영문 섞임', '12345678a'],
      ['전각 숫자', '１２３４５６７８'],
      ['하이픈만', '--------'],
      ['빈 문자열', ''],
    ])('반증: %s는 INVALID_ACCOUNT_NUMBER', (_label, raw) => {
      expect(() => normalizeAccountNumber(raw)).toThrowDomain(
        'INVALID_ACCOUNT_NUMBER',
      );
    });
  });

  describe('예금주', () => {
    it('1~50자(코드 포인트)를 trim해 받는다', () => {
      expect(normalizeAccountHolder(' 케이크샵 ')).toBe('케이크샵');
      expect(normalizeAccountHolder('가'.repeat(50))).toHaveLength(50);
      expect(normalizeAccountHolder('😀'.repeat(50))).toBe('😀'.repeat(50));
    });

    it.each([
      ['빈 문자열', '', 'TEXT_REQUIRED'],
      ['공백뿐', '   ', 'TEXT_REQUIRED'],
      ['51자', '가'.repeat(51), 'TEXT_TOO_LONG'],
    ])('반증: %s는 %s', (_label, raw, code) => {
      expect(() => normalizeAccountHolder(raw)).toThrowDomain(code);
    });
  });

  it('normalizeBankAccount는 세 값을 함께 정리한다', () => {
    expect(
      normalizeBankAccount({
        bankCode: '088',
        accountHolder: ' 홍길동 ',
        accountNumber: '110-123-456789',
      }),
    ).toEqual({
      bankCode: '088',
      accountHolder: '홍길동',
      accountNumber: '110123456789',
    });
  });

  it('toBank는 이름을 붙이고, 목록에서 빠진 코드는 코드를 이름으로 쓴다', () => {
    expect(toBank('004')).toEqual({ code: '004', name: 'KB국민은행' });
    expect(toBank('999')).toEqual({ code: '999', name: '999' });
  });

  it('maskAccountNumber는 끝 4자리만 보인다', () => {
    expect(maskAccountNumber('6789')).toBe('****6789');
  });
});
