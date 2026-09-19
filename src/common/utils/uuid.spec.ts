import { uuidV5 } from '@/common/utils/uuid';

// RFC 4122 부록의 DNS 네임스페이스 예시 벡터
const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidV5', () => {
  it('RFC 4122 예시 벡터와 일치한다(python uuid5(NAMESPACE_DNS, "python.org"))', () => {
    expect(uuidV5(DNS, 'python.org')).toBe(
      '886313e1-3b8a-5372-9b90-0c9aee199e5d',
    );
  });

  it('같은 입력은 같은 값, 이름이 다르면 다른 값이고 v5·variant 비트를 갖는다', () => {
    const a = uuidV5(DNS, 'a');
    expect(uuidV5(DNS, 'a')).toBe(a);
    expect(uuidV5(DNS, 'b')).not.toBe(a);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('반증: namespace가 UUID가 아니면 던진다', () => {
    expect(() => uuidV5('not-a-uuid', 'x')).toThrow('namespace');
  });
});
