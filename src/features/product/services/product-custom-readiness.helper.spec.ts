import type * as Catalog from '@/features/product/constants/custom-3d-catalog.constants';
import {
  evaluateProductCustomIssues,
  threeDCategoryOf,
  type ProductCustomReadinessOptionGroup,
  type ProductCustomReadinessSource,
} from '@/features/product/services/product-custom-readiness.helper';
import { CustomMode } from '@/generated/prisma/client';

const template = (
  slots: number,
  freeEdit: boolean,
  deleted = false,
): ProductCustomReadinessSource['custom_template'] => ({
  deleted_at: deleted ? new Date() : null,
  free_edit_enabled: freeEdit,
  text_tokens: Array.from({ length: slots }, (_, i) => ({ id: i })),
});

const item = (key: string | null, isActive = true) => ({
  is_active: isActive,
  three_d_key: key,
});

const group = (
  id: number,
  keys: (string | null | ReturnType<typeof item>)[],
  overrides: Partial<Omit<ProductCustomReadinessOptionGroup, 'id'>> = {},
): ProductCustomReadinessOptionGroup => ({
  id: BigInt(id),
  is_active: true,
  is_required: true,
  min_select: 1,
  max_select: 1,
  option_items: keys.map((k) =>
    typeof k === 'object' && k !== null ? k : item(k),
  ),
  ...overrides,
});

const optional = { is_required: false, min_select: 0, max_select: 1 };
const SHAPE = group(1, ['shape.heart', 'shape.circle']);
const SIZE = group(2, ['size.mini', 'size.no1']);

const codesOf = (groups: ProductCustomReadinessOptionGroup[]) =>
  evaluateProductCustomIssues(
    { custom_template: null, option_groups: groups },
    'THREE_D',
  ).map((i) => [i.code, i.optionGroupId]);

describe('evaluateProductCustomIssues', () => {
  it.each([
    ['NONE', '템플릿 없음', null, []],
    ['NONE', '빈 템플릿', template(0, false), []],
    ['SLOT', '템플릿 없음', null, ['SLOT_TEMPLATE_MISSING']],
    [
      'SLOT',
      '삭제된 템플릿',
      template(2, true, true),
      ['SLOT_TEMPLATE_MISSING'],
    ],
    [
      'SLOT',
      '문구 자리 0·자유 편집 끔',
      template(0, false),
      ['SLOT_NOTHING_TO_EDIT'],
    ],
    ['SLOT', '문구 자리 0·자유 편집 켬', template(0, true), []],
    ['SLOT', '문구 자리 1·자유 편집 끔', template(1, false), []],
    [
      'THREE_D',
      '문구 자리 있는 템플릿만',
      template(1, true),
      ['THREE_D_GROUP_MISSING', 'THREE_D_GROUP_MISSING'],
    ],
  ] as const)('%s · %s → %j', (mode, _label, customTemplate, codes) => {
    const issues = evaluateProductCustomIssues(
      { custom_template: customTemplate, option_groups: [] },
      mode,
    );
    expect(issues.map((i) => i.code)).toEqual(codes);
    for (const issue of issues) {
      expect(issue.message).toMatch(/[가-힣]/);
      expect(issue.optionGroupId).toBeNull();
    }
  });

  it('표가 모든 커스텀 방식을 덮는다', () => {
    expect(Object.values(CustomMode)).toEqual(['NONE', 'SLOT', 'THREE_D']);
  });

  describe('THREE_D', () => {
    it.each<
      [string, ProductCustomReadinessOptionGroup[], [string, string | null][]]
    >([
      [
        '그룹 없음',
        [],
        [
          ['THREE_D_GROUP_MISSING', null],
          ['THREE_D_GROUP_MISSING', null],
        ],
      ],
      ['모양·크기', [SHAPE, SIZE], []],
      [
        '모양·크기 + 고르지 않아도 되는 맛·디자인',
        [
          SHAPE,
          SIZE,
          group(3, ['flavor.cream'], optional),
          group(4, ['design.wave', 'design.drip'], optional),
        ],
        [],
      ],
      [
        '필수 맛·디자인',
        [SHAPE, SIZE, group(3, ['flavor.cream']), group(4, ['design.wave'])],
        [],
      ],
      [
        '3D와 무관한 그룹은 보지 않는다',
        [SHAPE, SIZE, group(3, [null, null], { max_select: 2 })],
        [],
      ],
      ['크기 없음', [SHAPE], [['THREE_D_GROUP_MISSING', null]]],
      [
        '숨긴 모양 그룹은 없는 것과 같다',
        [group(1, ['shape.heart'], { is_active: false }), SIZE],
        [['THREE_D_GROUP_MISSING', null]],
      ],
      [
        '숨긴 선택지의 키는 보지 않는다',
        [group(1, [item('shape.heart', false), null]), SIZE],
        [['THREE_D_GROUP_MISSING', null]],
      ],
      [
        '모양 그룹 둘',
        [SHAPE, SIZE, group(3, ['shape.star'])],
        [['THREE_D_GROUP_DUPLICATED', '3']],
      ],
      [
        '한 그룹에 모양·크기가 섞임',
        [group(1, ['shape.heart', 'size.mini'])],
        [
          ['THREE_D_GROUP_MISSING', null],
          ['THREE_D_GROUP_MISSING', null],
          ['THREE_D_GROUP_MIXED', '1'],
        ],
      ],
      [
        '3D 항목 미지정 선택지가 섞임',
        [group(1, ['shape.heart', null]), SIZE],
        [['THREE_D_GROUP_MIXED', '1']],
      ],
      [
        '모양 그룹이 필수가 아님',
        [group(1, ['shape.heart'], { is_required: false }), SIZE],
        [['THREE_D_GROUP_NOT_SINGLE_SELECT', '1']],
      ],
      [
        '모양 그룹 최대 2개',
        [group(1, ['shape.heart'], { max_select: 2 }), SIZE],
        [['THREE_D_GROUP_NOT_SINGLE_SELECT', '1']],
      ],
      [
        '크기 그룹 최소 0개',
        [SHAPE, group(2, ['size.mini'], { min_select: 0 })],
        [['THREE_D_GROUP_NOT_SINGLE_SELECT', '2']],
      ],
      [
        '맛 그룹 최대 2개',
        [
          SHAPE,
          SIZE,
          group(3, ['flavor.cream'], { ...optional, max_select: 2 }),
        ],
        [['THREE_D_GROUP_NOT_SINGLE_SELECT', '3']],
      ],
      [
        '디자인 그룹 2개 선택',
        [
          SHAPE,
          SIZE,
          group(4, ['design.wave'], { min_select: 2, max_select: 2 }),
        ],
        [['THREE_D_GROUP_NOT_SINGLE_SELECT', '4']],
      ],
      [
        '한 그룹에 같은 키 둘',
        [group(1, ['shape.heart', 'shape.heart']), SIZE],
        [['THREE_D_KEY_DUPLICATED', '1']],
      ],
      [
        '두 그룹에 같은 키',
        [SHAPE, SIZE, group(3, ['shape.heart'])],
        [
          ['THREE_D_KEY_DUPLICATED', '3'],
          ['THREE_D_GROUP_DUPLICATED', '3'],
        ],
      ],
      [
        '카탈로그에 없는 키가 섞임',
        [group(1, ['shape.heart', 'shape.moon']), SIZE],
        [['THREE_D_KEY_UNAVAILABLE', '1']],
      ],
      [
        '키가 전부 카탈로그 밖',
        [group(1, ['moon']), SIZE],
        [
          ['THREE_D_GROUP_MISSING', null],
          ['THREE_D_KEY_UNAVAILABLE', '1'],
        ],
      ],
    ])('%s', (_label, groups, expected) => {
      expect(codesOf(groups)).toEqual(expected);
    });

    it('이슈 메시지는 카테고리 이름을 담은 한국어 문장이다', () => {
      const issues = evaluateProductCustomIssues(
        {
          custom_template: null,
          option_groups: [
            group(3, ['flavor.cream'], { max_select: 2 }),
            group(4, ['shape.heart'], { max_select: 2 }),
          ],
        },
        'THREE_D',
      );
      expect(issues.map((i) => i.message)).toEqual([
        '크기 옵션을 만들고 3D 항목과 연결해 주세요.',
        '맛 옵션은 최대 1개 선택으로 설정해 주세요.',
        '모양 옵션은 필수, 1개 선택으로 설정해 주세요.',
      ]);
    });

    it('퇴역한 키(selectable=false)는 쓸 수 없는 키다', () => {
      jest.isolateModules(() => {
        jest.doMock(
          '@/features/product/constants/custom-3d-catalog.constants',
          () => {
            const actual = jest.requireActual<typeof Catalog>(
              '@/features/product/constants/custom-3d-catalog.constants',
            );
            return {
              ...actual,
              findThreeDChoice: (key: string | null) => {
                const found = actual.findThreeDChoice(key);
                return key === 'shape.heart' && found
                  ? { ...found, selectable: false }
                  : found;
              },
            };
          },
        );
        const isolated = jest.requireActual<{
          evaluateProductCustomIssues: typeof evaluateProductCustomIssues;
        }>('@/features/product/services/product-custom-readiness.helper');
        expect(
          isolated
            .evaluateProductCustomIssues(
              { custom_template: null, option_groups: [SHAPE, SIZE] },
              'THREE_D',
            )
            .map((i) => [i.code, i.optionGroupId]),
        ).toEqual([['THREE_D_KEY_UNAVAILABLE', '1']]);
      });
    });
  });
});

describe('threeDCategoryOf', () => {
  it.each([
    ['한 카테고리', ['shape.heart', 'shape.star'], 'SHAPE'],
    ['미지정 선택지가 섞여도 카테고리는 하나', ['size.mini', null], 'SIZE'],
    ['카테고리가 섞이면 null', ['shape.heart', 'size.mini'], null],
    ['키가 없으면 null', [null], null],
    ['카탈로그 밖 키는 세지 않는다', ['moon', 'flavor.choco'], 'FLAVOR'],
  ] as const)('%s → %s', (_label, keys, expected) => {
    expect(threeDCategoryOf(group(1, [...keys]))).toBe(expected);
  });

  it('숨긴 선택지의 키는 세지 않는다', () => {
    expect(
      threeDCategoryOf(group(1, [item('design.wave', false), 'flavor.cream'])),
    ).toBe('FLAVOR');
  });
});
