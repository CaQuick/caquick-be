import type * as Catalog from '@/features/product/constants/custom-3d-catalog.constants';
import {
  THREE_D_DECOS,
  THREE_D_EFFECTS,
  THREE_D_SHEET_COLORS,
} from '@/features/product/constants/custom-3d-catalog.constants';
import {
  validateThreeDDesign,
  type ThreeDDesignItemSource,
  type ThreeDDesignSource,
} from '@/features/product/services/three-d-design.helper';

const SELECTED = ['shape.heart', 'size.no1', 'design.wave', 'flavor.cream'];

const text = (
  overrides: Partial<ThreeDDesignItemSource> = {},
): ThreeDDesignItemSource => ({
  kind: 'TEXT',
  x: 0.5,
  y: 0.5,
  size: 8,
  effect: { type: 'none', intensity: 50 },
  text: '생일 축하해',
  color: '#1d1d1d',
  ...overrides,
});

const deco = (
  overrides: Partial<ThreeDDesignItemSource> = {},
): ThreeDDesignItemSource => ({
  kind: 'DECO',
  x: 0.2,
  y: 0.3,
  size: 20,
  effect: { type: 'soft', intensity: 0 },
  decoId: 'number-1',
  ...overrides,
});

const design = (
  overrides: Partial<ThreeDDesignSource> = {},
  basic: Partial<ThreeDDesignSource['basic']> = {},
): ThreeDDesignSource => ({
  schemaVersion: 1,
  basic: {
    shape: 'heart',
    size: 'no1',
    design: 'wave',
    flavor: 'cream',
    sheetColor: 'white',
    ...basic,
  },
  top: [text(), deco()],
  side: [deco()],
  ...overrides,
});

const times = <T>(n: number, make: () => T): T[] =>
  Array.from({ length: n }, make);

describe('validateThreeDDesign', () => {
  it('통과한 디자인을 저장할 정규형으로 돌려준다(글자색 대문자)', () => {
    expect(validateThreeDDesign(design(), SELECTED)).toEqual({
      schemaVersion: 1,
      basic: {
        shape: 'heart',
        size: 'no1',
        design: 'wave',
        flavor: 'cream',
        sheetColor: 'white',
      },
      top: [
        {
          kind: 'TEXT',
          x: 0.5,
          y: 0.5,
          size: 8,
          effect: { type: 'none', intensity: 50 },
          text: '생일 축하해',
          color: '#1D1D1D',
        },
        {
          kind: 'DECO',
          x: 0.2,
          y: 0.3,
          size: 20,
          effect: { type: 'soft', intensity: 0 },
          decoId: 'number-1',
        },
      ],
      side: [
        {
          kind: 'DECO',
          x: 0.2,
          y: 0.3,
          size: 20,
          effect: { type: 'soft', intensity: 0 },
          decoId: 'number-1',
        },
      ],
    });
  });

  it('글자는 줄바꿈을 LF로 바꾸고 앞뒤 공백을 지운다(줄바꿈·이모지 허용)', () => {
    const result = validateThreeDDesign(
      design({ top: [text({ text: '  축하해\r\n🎂\r고마워 \n' })], side: [] }),
      SELECTED,
    );
    expect(result.top[0]).toMatchObject({ text: '축하해\n🎂\n고마워' });
  });

  it('면이 비어 있어도 된다', () => {
    const result = validateThreeDDesign(
      design({ top: [], side: [] }),
      SELECTED,
    );
    expect(result.top).toEqual([]);
    expect(result.side).toEqual([]);
  });

  it.each([0, 2, 1.5])('schemaVersion %s 는 지원하지 않는다', (version) => {
    expect(() =>
      validateThreeDDesign(design({ schemaVersion: version }), SELECTED),
    ).toThrowDomain('CUSTOM_3D_SCHEMA_UNSUPPORTED');
  });

  describe('basic ↔ 고른 옵션', () => {
    it.each<[string, Partial<ThreeDDesignSource['basic']>, (string | null)[]]>([
      [
        '디자인·맛을 고르지 않았고 둘 다 null',
        { design: null, flavor: null },
        ['shape.heart', 'size.no1'],
      ],
      [
        '디자인·맛을 고르지 않았고 둘 다 생략',
        { design: undefined, flavor: undefined },
        ['shape.heart', 'size.no1'],
      ],
      [
        '3D와 무관한 항목·모르는 키는 보지 않는다',
        {},
        [...SELECTED, null, 'candle.big'],
      ],
    ])('통과: %s', (_label, basic, selected) => {
      expect(() =>
        validateThreeDDesign(design({}, basic), selected),
      ).not.toThrow();
    });

    it.each<[string, Partial<ThreeDDesignSource['basic']>, (string | null)[]]>([
      ['모양이 다름', { shape: 'star' }, SELECTED],
      ['크기가 다름', { size: 'mini' }, SELECTED],
      ['모양을 고르지 않음', {}, ['size.no1', 'design.wave', 'flavor.cream']],
      [
        '크기를 고르지 않음',
        {},
        ['shape.heart', 'design.wave', 'flavor.cream'],
      ],
      ['디자인을 골랐는데 null', { design: null }, SELECTED],
      ['디자인을 골랐는데 다름', { design: 'drip' }, SELECTED],
      [
        '디자인을 고르지 않았는데 값이 있음',
        {},
        ['shape.heart', 'size.no1', 'flavor.cream'],
      ],
      ['맛을 골랐는데 null', { flavor: null }, SELECTED],
      [
        '맛을 고르지 않았는데 값이 있음',
        {},
        ['shape.heart', 'size.no1', 'design.wave'],
      ],
      ['같은 카테고리를 둘 고름', {}, [...SELECTED, 'shape.star']],
    ])('CUSTOM_3D_OPTIONS_CHANGED: %s', (_label, basic, selected) => {
      expect(() =>
        validateThreeDDesign(design({}, basic), selected),
      ).toThrowDomain('CUSTOM_3D_OPTIONS_CHANGED');
    });
  });

  describe('면당 개수', () => {
    it.each(['top', 'side'] as const)(
      '%s 에 글자 10개·꾸미기 10개까지 올릴 수 있다',
      (face) => {
        const items = [...times(10, () => text()), ...times(10, () => deco())];
        expect(() =>
          validateThreeDDesign(design({ [face]: items }), SELECTED),
        ).not.toThrow();
      },
    );

    it.each([
      ['top', '글자', () => text()],
      ['top', '꾸미기', () => deco()],
      ['side', '글자', () => text()],
      ['side', '꾸미기', () => deco()],
    ] as const)('%s 에 %s 11개는 넘친다', (face, _label, make) => {
      const run = () =>
        validateThreeDDesign(design({ [face]: times(11, make) }), SELECTED);
      expect(run).toThrowDomain('CUSTOM_3D_ITEM_LIMIT_EXCEEDED');
      expect(run).toThrow('10개');
    });
  });

  describe('값 범위', () => {
    const top = (item: ThreeDDesignItemSource) => design({ top: [item] });

    it.each<[string, ThreeDDesignSource]>([
      ['x·y 0', top(text({ x: 0, y: 0 }))],
      ['x·y 1', top(deco({ x: 1, y: 1 }))],
      ['글자 크기 4', top(text({ size: 4 }))],
      ['글자 크기 30', top(text({ size: 30 }))],
      ['꾸미기 크기 8', top(deco({ size: 8 }))],
      ['꾸미기 크기 50', top(deco({ size: 50 }))],
      ['효과 강도 0', top(text({ effect: { type: 'none', intensity: 0 } }))],
      [
        '효과 강도 100',
        top(text({ effect: { type: 'none', intensity: 100 } })),
      ],
      ['글자 30자(이모지 코드 포인트)', top(text({ text: '🎂'.repeat(30) }))],
      ['카탈로그에 없는 임의 글자색', top(text({ color: '#a1B2c3' }))],
      ['decoId·text·color를 null로 보냄', top(text({ decoId: null }))],
      ['꾸미기의 text·color null', top(deco({ text: null, color: null }))],
      ...THREE_D_SHEET_COLORS.map((c): [string, ThreeDDesignSource] => [
        `시트 색 ${c.key}`,
        design({}, { sheetColor: c.key }),
      ]),
      ...THREE_D_EFFECTS.map((e): [string, ThreeDDesignSource] => [
        `효과 ${e.key}`,
        top(deco({ effect: { type: e.key, intensity: 50 } })),
      ]),
      ...THREE_D_DECOS.map((d): [string, ThreeDDesignSource] => [
        `꾸미기 ${d.key}`,
        top(deco({ decoId: d.key })),
      ]),
    ])('통과: %s', (_label, input) => {
      expect(() => validateThreeDDesign(input, SELECTED)).not.toThrow();
    });

    it.each<[string, ThreeDDesignSource, string]>([
      [
        '시트 색이 카탈로그 밖',
        design({}, { sheetColor: 'black' }),
        'basic.sheetColor',
      ],
      ['x < 0', top(text({ x: -0.01 })), 'top[0].x'],
      ['x > 1', top(text({ x: 1.01 })), 'top[0].x'],
      ['x NaN', top(deco({ x: Number.NaN })), 'top[0].x'],
      ['y < 0', top(text({ y: -0.01 })), 'top[0].y'],
      ['y 무한대', top(deco({ y: Number.POSITIVE_INFINITY })), 'top[0].y'],
      ['옆면 y > 1', design({ side: [deco({ y: 1.5 })] }), 'side[0].y'],
      ['글자 크기 3.99', top(text({ size: 3.99 })), 'top[0].size'],
      ['글자 크기 30.01', top(text({ size: 30.01 })), 'top[0].size'],
      ['꾸미기 크기 7.99', top(deco({ size: 7.99 })), 'top[0].size'],
      ['꾸미기 크기 50.01', top(deco({ size: 50.01 })), 'top[0].size'],
      ['꾸미기 크기 NaN', top(deco({ size: Number.NaN })), 'top[0].size'],
      [
        '효과 종류가 카탈로그 밖',
        top(text({ effect: { type: 'blur', intensity: 50 } })),
        'top[0].effect.type',
      ],
      [
        '효과 강도 -1',
        top(text({ effect: { type: 'none', intensity: -1 } })),
        'top[0].effect.intensity',
      ],
      [
        '효과 강도 101',
        top(text({ effect: { type: 'none', intensity: 101 } })),
        'top[0].effect.intensity',
      ],
      [
        '효과 강도 소수',
        top(deco({ effect: { type: 'soft', intensity: 50.5 } })),
        'top[0].effect.intensity',
      ],
      ['빈 글자', top(text({ text: '' })), 'top[0].text'],
      ['공백·줄바꿈뿐인 글자', top(text({ text: ' \r\n ' })), 'top[0].text'],
      ['글자 없음', top(text({ text: null })), 'top[0].text'],
      ['글자 31자', top(text({ text: '가'.repeat(31) })), 'top[0].text'],
      ['글자색 없음', top(text({ color: null })), 'top[0].color'],
      ['글자색 이름', top(text({ color: 'red' })), 'top[0].color'],
      ['글자색 5자리', top(text({ color: '#12345' })), 'top[0].color'],
      ['글자색 16진수 아님', top(text({ color: '#GGGGGG' })), 'top[0].color'],
      ['글자에 decoId', top(text({ decoId: 'number-1' })), 'top[0].decoId'],
      [
        '꾸미기 decoId 카탈로그 밖',
        top(deco({ decoId: 'number-8' })),
        'top[0].decoId',
      ],
      ['꾸미기 decoId 없음', top(deco({ decoId: null })), 'top[0].decoId'],
      ['꾸미기에 글자', top(deco({ text: '1' })), 'top[0].text'],
      ['꾸미기에 글자색', top(deco({ color: '#000000' })), 'top[0].color'],
      [
        '모르는 종류',
        top({ ...deco(), kind: 'IMAGE' as 'DECO' }),
        'top[0].kind',
      ],
      [
        '두 번째 항목',
        design({ side: [deco(), deco({ size: 51 })] }),
        'side[1].size',
      ],
    ])('CUSTOM_3D_DESIGN_INVALID: %s', (_label, input, field) => {
      const run = () => validateThreeDDesign(input, SELECTED);
      expect(run).toThrowDomain('CUSTOM_3D_DESIGN_INVALID');
      expect(run).toThrow(`(${field})`);
    });
  });

  describe('퇴역 항목(selectable=false)', () => {
    const CATALOG = '@/features/product/constants/custom-3d-catalog.constants';
    const retire = <T extends { key: string }>(
      list: readonly T[],
      key: string,
    ) => list.map((e) => (e.key === key ? { ...e, selectable: false } : e));

    it.each<[string, Partial<typeof Catalog>, string]>([
      [
        '시트 색',
        { THREE_D_SHEET_COLORS: retire(THREE_D_SHEET_COLORS, 'white') },
        'basic.sheetColor',
      ],
      [
        '효과',
        { THREE_D_EFFECTS: retire(THREE_D_EFFECTS, 'soft') },
        'top[1].effect.type',
      ],
      [
        '꾸미기',
        { THREE_D_DECOS: retire(THREE_D_DECOS, 'number-1') },
        'top[1].decoId',
      ],
    ])('%s: 퇴역한 값은 새 주문에서 거절한다', (_label, override, field) => {
      let error: unknown;
      jest.isolateModules(() => {
        jest.doMock(CATALOG, () => ({
          ...jest.requireActual<typeof Catalog>(CATALOG),
          ...override,
        }));
        const isolated = jest.requireActual<{
          validateThreeDDesign: typeof validateThreeDDesign;
        }>('@/features/product/services/three-d-design.helper');
        try {
          isolated.validateThreeDDesign(design(), SELECTED);
        } catch (e) {
          error = e;
        }
      });
      // 격리 레지스트리의 DomainException은 클래스가 달라 toThrowDomain 대신 code를 본다
      expect(error).toMatchObject({
        code: 'CUSTOM_3D_DESIGN_INVALID',
        message: expect.stringContaining(`(${field})`),
      });
    });
  });

  it('검사 순서: 버전 → 옵션 → 개수 → 값', () => {
    const broken = design(
      { schemaVersion: 2, top: times(11, () => text({ x: 2 })) },
      { shape: 'star' },
    );
    expect(() => validateThreeDDesign(broken, SELECTED)).toThrowDomain(
      'CUSTOM_3D_SCHEMA_UNSUPPORTED',
    );
    expect(() =>
      validateThreeDDesign({ ...broken, schemaVersion: 1 }, SELECTED),
    ).toThrowDomain('CUSTOM_3D_OPTIONS_CHANGED');
    expect(() =>
      validateThreeDDesign(
        { ...broken, schemaVersion: 1, basic: design().basic },
        SELECTED,
      ),
    ).toThrowDomain('CUSTOM_3D_ITEM_LIMIT_EXCEEDED');
  });
});
