import { generateRandomToken, sha256Hex } from '@/common/helpers/crypto.helper';

describe('crypto.helper', () => {
  describe('sha256Hex', () => {
    it('동일 입력에 대해 동일 해시를 반환한다', () => {
      const hash1 = sha256Hex('hello');
      const hash2 = sha256Hex('hello');
      expect(hash1).toBe(hash2);
    });

    it('결과가 64자 16진수 문자열이다', () => {
      expect(sha256Hex('test')).toMatch(/^[a-f0-9]{64}$/);
    });

    it('다른 입력이면 다른 해시를 반환한다', () => {
      expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
    });
  });

  describe('generateRandomToken', () => {
    it('기본값(32바이트)이면 64자 16진수 문자열을 반환한다', () => {
      expect(generateRandomToken()).toMatch(/^[a-f0-9]{64}$/);
    });

    it('지정 바이트 수에 맞는 길이를 반환한다', () => {
      expect(generateRandomToken(16)).toHaveLength(32);
    });

    it('호출마다 다른 값을 반환한다', () => {
      expect(generateRandomToken()).not.toBe(generateRandomToken());
    });
  });
});
