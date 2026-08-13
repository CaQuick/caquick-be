import { buildWithdrawnProviderSubject } from '@/common/utils/withdrawn-identity';

describe('buildWithdrawnProviderSubject', () => {
  it('withdrawn:<accountId>:<subject> 형식으로 익명화한다', () => {
    expect(buildWithdrawnProviderSubject(BigInt(7), 'kakao-sub-123')).toBe(
      'withdrawn:7:kakao-sub-123',
    );
  });

  it('계정이 다르면 같은 subject 라도 결과가 다르다', () => {
    const first = buildWithdrawnProviderSubject(BigInt(1), 'same-sub');
    const second = buildWithdrawnProviderSubject(BigInt(2), 'same-sub');

    expect(first).not.toBe(second);
  });

  it('VarChar(255) 한도를 넘지 않도록 자른다', () => {
    const longSubject = 'a'.repeat(300);

    const result = buildWithdrawnProviderSubject(BigInt(1), longSubject);

    expect(result).toHaveLength(255);
    expect(result.startsWith('withdrawn:1:')).toBe(true);
  });
});
