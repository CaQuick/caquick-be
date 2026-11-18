import { Logger } from '@nestjs/common';

import { readStoredThreeDDesign } from '@/features/order/services/order-custom-design.helper';
import type { Prisma } from '@/generated/prisma/client';

const TEXT = {
  kind: 'TEXT',
  x: 0.5,
  y: 0.25,
  size: 12,
  effect: { type: 'soft', intensity: 50 },
  text: '생일\n축하해 🎂',
  color: '#1D1D1D',
};
const DECO = {
  kind: 'DECO',
  x: 0.1,
  y: 0.9,
  size: 20,
  effect: { type: 'none', intensity: 0 },
  decoId: 'number-3',
};
const DESIGN = {
  schemaVersion: 1,
  basic: {
    shape: 'circle',
    size: 'no1',
    design: 'wave',
    flavor: null,
    sheetColor: 'pink',
  },
  top: [TEXT, DECO],
  side: [DECO],
};

const read = (design_json: unknown, schema_version = 1) =>
  readStoredThreeDDesign(42n, {
    schema_version,
    design_json: design_json as Prisma.JsonValue,
  });

type Node = Record<string | number, unknown>;

/** DESIGN을 깊은 복사한 뒤 path 위치 값을 바꾼다. undefined면 그 키를 지운다. */
function patched(path: (string | number)[], value: unknown): unknown {
  const copy = structuredClone(DESIGN) as unknown as Node;
  const parent = path
    .slice(0, -1)
    .reduce<Node>((node, key) => node[key] as Node, copy);
  const last = path[path.length - 1];
  if (value === undefined) delete parent[last];
  else parent[last] = value;
  return copy;
}

describe('readStoredThreeDDesign', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('저장된 v1 디자인을 그대로 읽고 항목 종류에 없는 칸은 null로 채운다', () => {
    expect(read(DESIGN)).toEqual({
      ...DESIGN,
      top: [
        { ...TEXT, decoId: null },
        { ...DECO, text: null, color: null },
      ],
      side: [{ ...DECO, text: null, color: null }],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('디자인·맛 키가 빠져 있으면 null로 읽는다', () => {
    const noFlavor = patched(['basic', 'flavor'], undefined) as Node;
    delete (noFlavor.basic as Node).design;
    expect(read(noFlavor)?.basic).toMatchObject({ design: null, flavor: null });
  });

  it('디자인 행이 없으면 기록 없이 null이다', () => {
    expect(readStoredThreeDDesign(1n, null)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('지원하지 않는 컬럼 버전이면 null + 기록', () => {
    expect(read(DESIGN, 2)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('orderItemId=42'),
    );
  });

  // 콜백 인자 수가 행 길이보다 많으면 jest가 마지막 인자를 done으로 본다 — 행과 인자 수를 맞춘다
  it.each<[string, unknown]>([
    ['JSON 버전이 컬럼과 다름', patched(['schemaVersion'], 2)],
    ['JSON이 객체가 아님', [DESIGN]],
    ['JSON이 null', null],
    ['basic 없음', patched(['basic'], undefined)],
    ['shape가 문자열이 아님', patched(['basic', 'shape'], 3)],
    ['size 없음', patched(['basic', 'size'], undefined)],
    ['sheetColor 없음', patched(['basic', 'sheetColor'], undefined)],
    ['design이 문자열·null이 아님', patched(['basic', 'design'], 1)],
    ['flavor가 문자열·null이 아님', patched(['basic', 'flavor'], {})],
    ['top이 배열이 아님', patched(['top'], {})],
    ['side 없음', patched(['side'], undefined)],
    ['항목이 객체가 아님', patched(['top', 0], 'TEXT')],
    ['모르는 항목 종류', patched(['top', 0, 'kind'], 'IMAGE')],
    ['x가 수가 아님', patched(['top', 0, 'x'], '0.5')],
    ['y 없음', patched(['side', 0, 'y'], undefined)],
    ['size가 유한수가 아님', patched(['top', 1, 'size'], null)],
    ['effect 없음', patched(['top', 0, 'effect'], undefined)],
    ['effect.type이 문자열이 아님', patched(['top', 0, 'effect', 'type'], 1)],
    [
      'effect.intensity가 정수가 아님',
      patched(['top', 0, 'effect', 'intensity'], 0.5),
    ],
    ['글자에 text 없음', patched(['top', 0, 'text'], undefined)],
    ['글자에 color 없음', patched(['top', 0, 'color'], undefined)],
    ['꾸미기에 decoId 없음', patched(['side', 0, 'decoId'], undefined)],
  ])('%s → null + 기록', (_case, json) => {
    expect(read(json)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('orderItemId=42'),
    );
  });
});
