import { sha256Hex } from '@/common/utils/crypto';
import { buildWithdrawnProviderSubject } from '@/common/utils/withdrawn-identity';

describe('buildWithdrawnProviderSubject', () => {
  it('withdrawn:<accountId>:<sha256> 형식으로 익명화한다', () => {
    expect(buildWithdrawnProviderSubject(BigInt(7), 'kakao-sub-123')).toBe(
      `withdrawn:7:${sha256Hex('kakao-sub-123')}`,
    );
  });

  it('원본 subject를 그대로 남기지 않는다', () => {
    const result = buildWithdrawnProviderSubject(BigInt(7), 'kakao-sub-123');

    expect(result).not.toContain('kakao-sub-123');
  });

  it('계정이 다르면 같은 subject라도 결과가 다르다', () => {
    const first = buildWithdrawnProviderSubject(BigInt(1), 'same-sub');
    const second = buildWithdrawnProviderSubject(BigInt(2), 'same-sub');

    expect(first).not.toBe(second);
  });

  it('subject가 길어도 VarChar(255) 한도 안에 들어간다', () => {
    const longSubject = 'a'.repeat(300);

    const result = buildWithdrawnProviderSubject(BigInt(1), longSubject);

    expect(result.length).toBeLessThanOrEqual(255);
    expect(result.startsWith('withdrawn:1:')).toBe(true);
  });
});
