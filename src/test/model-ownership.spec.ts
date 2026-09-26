import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { FEATURE_SERVICE, MODEL_OWNERSHIP } from '@/test/model-ownership';
import {
  collectWriteSites,
  isAllowedWriter,
  listFeatureDirs,
  loadSchema,
  relPath,
  type WriteSite,
} from '@/test/model-ownership.helper';

// 모델별 단일 writer를 코드로 강제한다. 판정은 write 호출이 놓인 feature 파일 기준.
// 아래 예외 목록은 P1 진행 중 실측(시작 92 사이트 → 0)이며, 이제 비어 있다 — 한 줄이라도 생기면 실패한다.

const schema = loadSchema();

/** [파일, 모델, 사이트 수] — 소유 feature 밖에서 write하는 현재 코드. P1-12로 비웠다. */
const WRITE_EXCEPTIONS: Array<[file: string, model: string, sites: number]> =
  [];

function groupViolations(
  sites: WriteSite[],
  base?: string,
): Array<[string, string, number]> {
  const counts = new Map<string, number>();
  for (const site of sites) {
    if (isAllowedWriter(site)) continue;
    const file = base ? relative(base, site.file) : relPath(site.file);
    const key = `${file}|${site.model}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, n]) => {
      const [file, model] = key.split('|');
      return [file, model, n];
    });
}

describe('모델 소유권 (단일 writer)', () => {
  it('소유 맵은 스키마 모델 전수와 1:1이다', () => {
    expect(Object.keys(MODEL_OWNERSHIP).sort()).toEqual(
      [...schema.models].sort(),
    );
  });

  it('feature→서비스 매핑의 feature는 실제 디렉터리에 존재한다', () => {
    const dirs = new Set(listFeatureDirs());
    for (const feature of Object.keys(FEATURE_SERVICE))
      expect(dirs.has(feature)).toBe(true);
  });

  it('소유 feature 밖 write는 예외 목록과 정확히 일치한다', () => {
    const found = groupViolations(collectWriteSites(schema));
    expect(found).toEqual(WRITE_EXCEPTIONS);
    expect(found.reduce((sum, [, , n]) => sum + n, 0)).toBe(0);
  });

  describe('검사기 반증', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'ownership-'));
      mkdirSync(join(dir, 'product'), { recursive: true });
      mkdirSync(join(dir, 'review'), { recursive: true });
      // 허용 밖 feature의 직접 write + relation 아래 nested create(객체·배열·&& 스프레드)·inverse 측 connect + 상수/헬퍼(this 메서드·로컬 함수·파라미터 전달)로 넘긴 인자
      writeFileSync(
        join(dir, 'product', 'bad.repository.ts'),
        [
          'const payload = { rating: 5, media: { createMany: { data: [] } } } as const;',
          'const createArgs = { data: { media: { create: [] } } };',
          'function payloadOf() { return { data: { media: { create: [] } } }; }',
          'const wrap = (args: any) => args;',
          'export class Bad {',
          '  constructor(private readonly prisma: any) {}',
          '  private buildArgs() { return { data: { media: { create: [] } } }; }',
          '  f(tx: any, prisma: any, flag: boolean, trx: any) {',
          '    tx.review.create({ data: payload });',
          '    tx.review.create(createArgs);',
          '    tx.review.create(this.buildArgs());',
          '    tx.review.create(payloadOf());',
          '    tx.review.create(wrap({ data: { media: { create: [] } } }));',
          '    tx.orderItem.update({ where: { id: 1n }, data: { review: { connect: { id: 1n } } } });',
          '    trx.review.delete({ where: { id: 1n } });',
          '    prisma.order.update({ where: { id: 1n }, data: { ...(flag && { status_histories: { create: {} } }) } });',
          '    prisma.order.update({ where: { id: 1n }, data: { status_histories: { create: {} } } });',
          '    prisma.order.update({ where: { id: 1n }, data: { items: { create: [{ review: { create: {} } }] } } });',
          '    this.prisma.product.update({ where: { id: 1n }, data: {} });',
          '  }',
          '}',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'review', 'ok.repository.ts'),
        [
          'export function g(tx: any) {',
          '  tx.review.create({ data: { media: { create: [] } } });',
          '  // FK(order_item_id)가 Review 쪽이라 connect는 Review 자신의 write — OrderItem write로 세지 않는다',
          '  tx.review.update({ where: { id: 1n }, data: { order_item: { connect: { id: 1n } } } });',
          '}',
        ].join('\n'),
      );
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('허용 밖 feature의 직접·nested(객체·배열·&&)·inverse 측 connect·상수·헬퍼(파라미터 전달 포함) 인자 write를 수신자 이름과 무관하게 모두 잡고, 소유 feature의 write와 FK 보유 측 connect는 통과시킨다', () => {
      const found = groupViolations(collectWriteSites(schema, dir), dir);
      expect(found).toEqual([
        ['product/bad.repository.ts', 'Order', 3],
        ['product/bad.repository.ts', 'OrderItem', 2],
        ['product/bad.repository.ts', 'OrderStatusHistory', 2],
        ['product/bad.repository.ts', 'Review', 8],
        ['product/bad.repository.ts', 'ReviewMedia', 5],
      ]);
      const ok = collectWriteSites(schema, dir).filter(
        (s) => s.feature === 'review',
      );
      expect(ok.map((s) => s.model).sort()).toEqual([
        'Review',
        'Review',
        'ReviewMedia',
      ]);
      expect(ok.every(isAllowedWriter)).toBe(true);
    });
  });
});
