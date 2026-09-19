import { deterministicUuid } from '@/common/utils/uuid';

const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('deterministicUuid', () => {
  it('같은 입력은 같은 값이고, 이름·네임스페이스가 다르면 다른 값이며 v8·variant 비트를 갖는다', () => {
    const a = deterministicUuid(NS, 'a');
    expect(deterministicUuid(NS, 'a')).toBe(a);
    expect(deterministicUuid(NS, 'b')).not.toBe(a);
    expect(
      deterministicUuid('3f6d1a2e-7c4b-5e8a-9d0f-2b1c3d4e5f60', 'a'),
    ).not.toBe(a);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('값이 고정돼 있다(스냅샷) — 바뀌면 기존 멱등 키가 다른 event_id로 매핑된다', () => {
    expect(deterministicUuid(NS, 'python.org')).toBe(
      deterministicUuid(NS, 'python.org'),
    );
    expect(deterministicUuid(NS, '1:notice-2026-09-19')).toMatchInlineSnapshot(
      `"c9f23d2c-a5ec-8942-95c8-6c6abf79cdff"`,
    );
  });

  it('반증: namespace가 UUID가 아니면 던진다', () => {
    expect(() => deterministicUuid('not-a-uuid', 'x')).toThrow('namespace');
  });
});
