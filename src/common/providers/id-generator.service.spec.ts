import { IdGenerator } from '@/common/providers/id-generator.service';

describe('IdGenerator', () => {
  const gen = new IdGenerator();

  it('uuid()가 UUID v4 형식을 반환한다', () => {
    expect(gen.uuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('호출마다 다른 UUID를 반환한다', () => {
    expect(gen.uuid()).not.toBe(gen.uuid());
  });
});
