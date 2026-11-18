// 3D 케이크 카탈로그 정본. 판매자 앱 렌더러와 서버 디자인 검증이 같은 값을 쓴다.
// id(key)는 지우지 않고 selectable: false로 퇴역시키며, 값(hex·이미지·배율)은 바꾸지 않는다 — 과거 주문이 같은 모습으로 그려진다.
// 값을 바꿔야 하면 새 key를 더하고 옛 key를 퇴역시킨다. 에셋 경로는 assets/custom-3d-catalog/v1 기준이다.

/** 바꾸면 클라이언트 캐시를 버리게 한다. 항목을 더하거나 퇴역시킬 때 올린다. */
export const CUSTOM_3D_CATALOG_REVISION = 1;
/** 주문에 저장하는 디자인 JSON 버전. 해석이 바뀔 때만 올린다. */
export const THREE_D_DESIGN_SCHEMA_VERSION = 1;
/** 에셋 S3 key 접두. 로컬 원본은 assets/ 아래 같은 경로에 있다. */
export const CUSTOM_3D_ASSET_PREFIX = 'custom-3d-catalog/v1';

export const THREE_D_OPTION_CATEGORIES = [
  'SIZE',
  'FLAVOR',
  'SHAPE',
  'DESIGN',
] as const;
export type ThreeDOptionCategory = (typeof THREE_D_OPTION_CATEGORIES)[number];

export const THREE_D_CATEGORY_LABELS: Record<ThreeDOptionCategory, string> = {
  SIZE: '크기',
  FLAVOR: '맛',
  SHAPE: '모양',
  DESIGN: '디자인',
};

export interface ThreeDOptionChoice {
  /** 옵션 항목 three_d_key. 카테고리가 달라도 value가 겹칠 수 있어(heart) 카테고리를 앞에 붙인다. */
  key: string;
  category: ThreeDOptionCategory;
  /** 디자인 JSON basic에 들어가는 값 */
  value: string;
  label: string;
  defaultPriceDelta: number;
  imagePath: string | null;
  /** 위에서 본 케이크 판·옆모습 배율. SIZE만 */
  renderScale: number | null;
  selectable: boolean;
}

const choice = (
  category: ThreeDOptionCategory,
  value: string,
  label: string,
  defaultPriceDelta: number,
  extra: { imagePath?: string; renderScale?: number } = {},
): ThreeDOptionChoice => ({
  key: `${category.toLowerCase()}.${value}`,
  category,
  value,
  label,
  defaultPriceDelta,
  imagePath: extra.imagePath ?? null,
  renderScale: extra.renderScale ?? null,
  selectable: true,
});

const design = (value: string, label: string, price: number) =>
  choice('DESIGN', value, label, price, { imagePath: `design/${value}.png` });

export const THREE_D_OPTION_CHOICES: readonly ThreeDOptionChoice[] = [
  choice('SHAPE', 'heart', '하트', 1000),
  choice('SHAPE', 'circle', '원', 1000),
  choice('SHAPE', 'square', '네모', 1000),
  choice('SHAPE', 'star', '별', 1000),
  choice('SHAPE', 'triangle', '삼각', 1000),
  choice('SHAPE', 'bear', '곰', 1000),
  choice('SHAPE', 'clover', '클로버', 1000),
  choice('SHAPE', 'flower', '꽃', 1000),
  choice('SIZE', 'lunchbox', '도시락 (1~2인)', 0, { renderScale: 0.7 }),
  choice('SIZE', 'mini', '미니 (1~2인)', 0, { renderScale: 0.82 }),
  choice('SIZE', 'no1', '1호 (2~3인)', 5000, { renderScale: 1 }),
  design('wave', '물결', 0),
  design('drip', '흘림', 1000),
  design('phrase', '문구', 2000),
  design('heart', '하트', 1000),
  design('sparkle', '반짝', 1000),
  choice('FLAVOR', 'cream', '생크림', 0),
  choice('FLAVOR', 'vanilla', '바닐라', 0),
  choice('FLAVOR', 'choco', '초코', 0),
];

export interface ThreeDSheetColor {
  key: string;
  label: string;
  hex: string;
  selectable: boolean;
}

export const THREE_D_SHEET_COLORS: readonly ThreeDSheetColor[] = [
  { key: 'white', label: '화이트', hex: '#FFFFFF', selectable: true },
  { key: 'pink', label: '핑크', hex: '#FFC2CF', selectable: true },
  { key: 'yellow', label: '옐로우', hex: '#FFE08A', selectable: true },
  { key: 'green', label: '그린', hex: '#B9ECB7', selectable: true },
  { key: 'blue', label: '블루', hex: '#B5D2FF', selectable: true },
  { key: 'purple', label: '퍼플', hex: '#DCC4FF', selectable: true },
];

/** 편집기 팔레트 순서. 그 밖의 #RRGGBB도 허용한다. */
export const THREE_D_TEXT_COLOR_PRESETS: readonly string[] = [
  '#D9D9D9',
  '#EE3049',
  '#FF6A00',
  '#00A02A',
  '#0050D0',
  '#3D2A12',
  '#000000',
  '#FF6B9D',
  '#FFEE00',
  '#55DD3A',
  '#00AEDB',
  '#A38468',
  '#FFFFFF',
  '#FBC9CC',
  '#FFFD8A',
  '#C6FF3D',
  '#3EE8C0',
];
export const THREE_D_DEFAULT_TEXT_COLOR = '#1D1D1D';

export interface ThreeDEffect {
  key: string;
  label: string;
  selectable: boolean;
}

export const THREE_D_EFFECTS: readonly ThreeDEffect[] = [
  { key: 'none', label: '기본', selectable: true },
  { key: 'soft', label: '소프트', selectable: true },
  { key: 'drawing', label: '드로잉', selectable: true },
  { key: 'pencil', label: '연필', selectable: true },
];

export interface ThreeDDecoCategory {
  key: string;
  label: string;
}

export const THREE_D_DECO_CATEGORIES: readonly ThreeDDecoCategory[] = [
  { key: 'number', label: '숫자' },
];

export interface ThreeDDeco {
  key: string;
  category: string;
  label: string;
  imagePath: string;
  selectable: boolean;
}

export const THREE_D_DECOS: readonly ThreeDDeco[] = Array.from(
  { length: 8 },
  (_, n) => ({
    key: `number-${n}`,
    category: 'number',
    label: `${n}`,
    imagePath: `deco/number-${n}.png`,
    selectable: true,
  }),
);

/** 서버가 강제하는 한도. 크기 단위는 케이크 판 너비 대비 cqw. */
export const THREE_D_LIMITS = {
  maxTextsPerFace: 10,
  maxDecosPerFace: 10,
  maxTextLength: 30,
  textSizeMin: 4,
  textSizeMax: 30,
  decoSizeMin: 8,
  decoSizeMax: 50,
  effectIntensityMin: 0,
  effectIntensityMax: 100,
  effectIntensityDefault: 50,
} as const;

/** 카탈로그가 가리키는 에셋 상대 경로 전부. 에셋 대조 spec과 업로드 스크립트가 쓴다. */
export function catalogAssetPaths(): string[] {
  return [
    ...THREE_D_OPTION_CHOICES.flatMap((c) =>
      c.imagePath ? [c.imagePath] : [],
    ),
    ...THREE_D_DECOS.map((d) => d.imagePath),
  ];
}

const CHOICE_BY_KEY = new Map(THREE_D_OPTION_CHOICES.map((c) => [c.key, c]));

export function findThreeDChoice(
  key: string | null,
): ThreeDOptionChoice | undefined {
  return key === null ? undefined : CHOICE_BY_KEY.get(key);
}
