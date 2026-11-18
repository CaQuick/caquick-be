import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  catalogAssetPaths,
  CUSTOM_3D_ASSET_PREFIX,
  findThreeDChoice,
  THREE_D_DECO_CATEGORIES,
  THREE_D_DECOS,
  THREE_D_DEFAULT_TEXT_COLOR,
  THREE_D_EFFECTS,
  THREE_D_OPTION_CATEGORIES,
  THREE_D_OPTION_CHOICES,
  THREE_D_SHEET_COLORS,
  THREE_D_TEXT_COLOR_PRESETS,
} from '@/features/product/constants/custom-3d-catalog.constants';

const ASSET_ROOT = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'assets',
  CUSTOM_3D_ASSET_PREFIX,
);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function listAssetFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listAssetFiles(join(dir, entry.name))
      : [relative(ASSET_ROOT, join(dir, entry.name)).split(sep).join('/')],
  );
}

/** 상수가 가리키는데 없는 파일, 있는데 아무도 가리키지 않는 파일. */
function diffAssets(referenced: string[], files: string[]) {
  return {
    missing: referenced.filter((path) => !files.includes(path)),
    unreferenced: files.filter((path) => !referenced.includes(path)),
  };
}

describe('3D 카탈로그 에셋 대조', () => {
  const referenced = catalogAssetPaths();
  const files = listAssetFiles(ASSET_ROOT);

  it('대상이 비어 있지 않다(디자인 5 + 꾸미기 8)', () => {
    expect(referenced).toHaveLength(13);
    expect([...files].sort()).toEqual([...referenced].sort());
  });

  it('상수가 가리키는 파일이 모두 있고, 아무도 가리키지 않는 파일이 없다', () => {
    expect(diffAssets(referenced, files)).toEqual({
      missing: [],
      unreferenced: [],
    });
  });

  it('반증: 파일이 빠지거나 남으면 양쪽 모두 잡는다', () => {
    expect(diffAssets(referenced, referenced.slice(1))).toEqual({
      missing: [referenced[0]],
      unreferenced: [],
    });
    expect(
      diffAssets(referenced, [...referenced, 'deco/number-8.png']),
    ).toEqual({
      missing: [],
      unreferenced: ['deco/number-8.png'],
    });
  });

  it.each(referenced)('%s 는 PNG다', (path) => {
    const head = readFileSync(join(ASSET_ROOT, path)).subarray(0, 4);
    expect(head.equals(PNG_SIGNATURE)).toBe(true);
  });
});

describe('3D 카탈로그 상수', () => {
  // 값이 바뀌면 과거 주문이 다른 모습으로 그려진다. 바꿀 때는 새 key를 더하고 옛 key를 퇴역시킨다.
  it('선택지 값이 고정돼 있다', () => {
    expect(
      THREE_D_OPTION_CHOICES.map((c) => [
        c.key,
        c.value,
        c.defaultPriceDelta,
        c.renderScale,
        c.imagePath,
      ]),
    ).toEqual([
      ['shape.heart', 'heart', 1000, null, null],
      ['shape.circle', 'circle', 1000, null, null],
      ['shape.square', 'square', 1000, null, null],
      ['shape.star', 'star', 1000, null, null],
      ['shape.triangle', 'triangle', 1000, null, null],
      ['shape.bear', 'bear', 1000, null, null],
      ['shape.clover', 'clover', 1000, null, null],
      ['shape.flower', 'flower', 1000, null, null],
      ['size.lunchbox', 'lunchbox', 0, 0.7, null],
      ['size.mini', 'mini', 0, 0.82, null],
      ['size.no1', 'no1', 5000, 1, null],
      ['design.wave', 'wave', 0, null, 'design/wave.png'],
      ['design.drip', 'drip', 1000, null, 'design/drip.png'],
      ['design.phrase', 'phrase', 2000, null, 'design/phrase.png'],
      ['design.heart', 'heart', 1000, null, 'design/heart.png'],
      ['design.sparkle', 'sparkle', 1000, null, 'design/sparkle.png'],
      ['flavor.cream', 'cream', 0, null, null],
      ['flavor.vanilla', 'vanilla', 0, null, null],
      ['flavor.choco', 'choco', 0, null, null],
    ]);
    expect(THREE_D_SHEET_COLORS.map((c) => [c.key, c.hex])).toEqual([
      ['white', '#FFFFFF'],
      ['pink', '#FFC2CF'],
      ['yellow', '#FFE08A'],
      ['green', '#B9ECB7'],
      ['blue', '#B5D2FF'],
      ['purple', '#DCC4FF'],
    ]);
    expect(THREE_D_EFFECTS.map((e) => e.key)).toEqual([
      'none',
      'soft',
      'drawing',
      'pencil',
    ]);
    expect(THREE_D_DECOS.map((d) => [d.key, d.imagePath])).toEqual(
      Array.from({ length: 8 }, (_, n) => [
        `number-${n}`,
        `deco/number-${n}.png`,
      ]),
    );
    expect(THREE_D_TEXT_COLOR_PRESETS).toHaveLength(17);
    expect(THREE_D_DEFAULT_TEXT_COLOR).toBe('#1D1D1D');
  });

  it('선택지 key는 카테고리.값 형식이고 옵션 항목 칸(40자)에 들어간다', () => {
    for (const c of THREE_D_OPTION_CHOICES) {
      expect(c.key).toBe(`${c.category.toLowerCase()}.${c.value}`);
      expect(c.key.length).toBeLessThanOrEqual(40);
      expect(c.label.trim()).not.toBe('');
    }
  });

  it.each([
    ['선택지', THREE_D_OPTION_CHOICES],
    ['시트 색', THREE_D_SHEET_COLORS],
    ['효과', THREE_D_EFFECTS],
    ['꾸미기', THREE_D_DECOS],
    ['꾸미기 분류', THREE_D_DECO_CATEGORIES],
  ] as const)('%s key는 겹치지 않는다', (_label, entries) => {
    const keys = entries.map((e: { key: string }) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('카테고리마다 고를 수 있는 선택지가 있다', () => {
    const counts = Object.fromEntries(
      THREE_D_OPTION_CATEGORIES.map((category) => [
        category,
        THREE_D_OPTION_CHOICES.filter(
          (c) => c.category === category && c.selectable,
        ).length,
      ]),
    );
    expect(counts).toEqual({ SIZE: 3, FLAVOR: 3, SHAPE: 8, DESIGN: 5 });
  });

  it('색은 #RRGGBB 대문자다', () => {
    for (const hex of [
      ...THREE_D_SHEET_COLORS.map((c) => c.hex),
      ...THREE_D_TEXT_COLOR_PRESETS,
      THREE_D_DEFAULT_TEXT_COLOR,
    ]) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('꾸미기 분류는 목록에 있는 분류다', () => {
    const categories = new Set(THREE_D_DECO_CATEGORIES.map((c) => c.key));
    for (const deco of THREE_D_DECOS) {
      expect(categories.has(deco.category)).toBe(true);
    }
  });

  it.each([
    ['shape.heart', 'SHAPE'],
    ['design.heart', 'DESIGN'],
    ['heart', undefined],
    [null, undefined],
  ] as const)('findThreeDChoice(%s) → %s', (key, category) => {
    expect(findThreeDChoice(key)?.category).toBe(category);
  });
});
