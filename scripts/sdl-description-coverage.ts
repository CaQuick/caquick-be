/**
 * SDL description 커버리지 측정 로직.
 *
 * 왜: SDL에 설명 없는 필드를 추가해도 `yarn validate`가 통과한다. dto:check가
 * SDL↔DTO 동기화를 도구로 강제하듯, 문서 커버리지도 사람 주의력이 아니라
 * 게이트로 받쳐야 한다. (이슈 #250)
 *
 * 이 파일은 순수 함수만 둔다 — 파일 시스템 접근과 CLI는
 * check-sdl-description-coverage.ts가 담당한다. 그래야 spec에서 SDL 문자열만으로
 * 검증할 수 있다.
 */

import type { DefinitionNode, InputValueDefinitionNode } from 'graphql';
import { Kind, parse } from 'graphql';

/** 문서 트리 깊이 순. 게이트 출력도 이 순서를 따른다. */
export const CATEGORIES = [
  'rootField',
  'rootArgScalar',
  'inputType',
  'inputField',
  'outputType',
  'outputField',
  'enumType',
  'enumValue',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  rootField: 'Query/Mutation 필드',
  rootArgScalar: '루트 인자(스칼라·ID)',
  inputType: 'input 타입 선언',
  inputField: 'input 필드',
  outputType: '출력 type 선언',
  outputField: '출력 type 필드',
  enumType: 'enum 선언',
  enumValue: 'enum 값',
};

export interface CategoryStat {
  documented: number;
  total: number;
  /** 설명이 비어 있어 커버리지에서 빠진 요소들. `파일: 타입.필드` 형태. */
  missing: string[];
}

export type Coverage = Record<Category, CategoryStat>;

export interface SdlFile {
  /** 리포트에 찍히는 경로. 보통 src 기준 상대 경로. */
  path: string;
  sdl: string;
}

const ROOT_TYPES = new Set(['Query', 'Mutation', 'Subscription']);

/**
 * input 객체가 아니라 스칼라로 취급할 타입명.
 * 커스텀 스칼라를 추가하면 여기에도 넣어야 한다.
 */
const SCALAR_TYPE_NAMES = new Set([
  'String',
  'Int',
  'Float',
  'Boolean',
  'ID',
  'DateTime',
]);

/**
 * 이름만으로 의미가 자명해 설명을 요구하지 않는 필드.
 *
 * 왜 제외하는가: 전부 채우게 하면 "상품 ID" 같은 무의미한 설명이 수백 개 생긴다.
 * order-checkout.graphql이 이미 비자명 필드(idempotencyKey·pickupAt)에만 근거를
 * 적고 productId·quantity는 비워 뒀는데, 단순 유무 집계는 그 판단에 벌점을 준다.
 *
 * 제외는 분모에서 빼는 것일 뿐 작성을 막지 않는다 — 맥락이 필요하면 자유롭게 단다.
 */
const EXEMPT_FIELD_NAMES = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
]);

/** `productId`, `storeIds`처럼 대상이 이름에 드러나는 식별자. */
const EXEMPT_NAME_PATTERN = /(?:^|[a-z])Ids?$/;

export function isExemptFieldName(name: string): boolean {
  return EXEMPT_FIELD_NAMES.has(name) || EXEMPT_NAME_PATTERN.test(name);
}

/**
 * 타입 이름을 되풀이하기만 하는 자동생성형 설명인지.
 *
 * 왜 필요한가: seller SDL에 `"""SellerOrderSummary 타입"""` 같은 설명이 70건 있다.
 * 파서는 description이 있으므로 "문서화됨"으로 세지만 전달되는 정보는 0이다.
 * 이걸 걸러내지 않으면 임계치가 거짓 안전을 준다.
 */
export function isPlaceholderDescription(
  typeName: string,
  description: string,
): boolean {
  const trimmed = description.trim();
  if (trimmed.length === 0) return true;
  const pattern = new RegExp(
    `^${escapeRegExp(typeName)}\\s*(입력\\s*)?(타입|입력|enum|열거형)?\\.?$`,
    'i',
  );
  return pattern.test(trimmed);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function emptyCoverage(): Coverage {
  return CATEGORIES.reduce((acc, category) => {
    acc[category] = { documented: 0, total: 0, missing: [] };
    return acc;
  }, {} as Coverage);
}

function namedTypeOf(node: InputValueDefinitionNode): string {
  let type = node.type;
  while (type.kind !== Kind.NAMED_TYPE) type = type.type;
  return type.name.value;
}

export function collectCoverage(files: SdlFile[]): Coverage {
  const coverage = emptyCoverage();

  const record = (
    category: Category,
    file: string,
    label: string,
    hasDescription: boolean,
  ): void => {
    const stat = coverage[category];
    stat.total += 1;
    if (hasDescription) stat.documented += 1;
    else stat.missing.push(`${file}: ${label}`);
  };

  for (const { path, sdl } of files) {
    for (const def of parse(sdl).definitions) {
      collectDefinition(def, path, record);
    }
  }

  return coverage;
}

type Recorder = (
  category: Category,
  file: string,
  label: string,
  hasDescription: boolean,
) => void;

function collectDefinition(
  def: DefinitionNode,
  file: string,
  record: Recorder,
): void {
  if (
    def.kind === Kind.OBJECT_TYPE_DEFINITION ||
    def.kind === Kind.OBJECT_TYPE_EXTENSION
  ) {
    const typeName = def.name.value;
    if (ROOT_TYPES.has(typeName)) {
      for (const field of def.fields ?? []) {
        record(
          'rootField',
          file,
          `${typeName}.${field.name.value}`,
          Boolean(field.description?.value.trim()),
        );
        for (const arg of field.arguments ?? []) {
          // input 객체 인자는 설명을 input 타입 쪽에 두면 되므로 게이트 대상이 아니다.
          // 스칼라·ID 인자는 인자 설명 외에 형식을 적을 자리가 없다.
          if (!SCALAR_TYPE_NAMES.has(namedTypeOf(arg))) continue;
          if (isExemptFieldName(arg.name.value)) continue;
          record(
            'rootArgScalar',
            file,
            `${typeName}.${field.name.value}(${arg.name.value})`,
            Boolean(arg.description?.value.trim()),
          );
        }
      }
      return;
    }

    if (def.kind === Kind.OBJECT_TYPE_DEFINITION) {
      record(
        'outputType',
        file,
        typeName,
        !isPlaceholderDescription(typeName, def.description?.value ?? ''),
      );
    }
    for (const field of def.fields ?? []) {
      if (isExemptFieldName(field.name.value)) continue;
      record(
        'outputField',
        file,
        `${typeName}.${field.name.value}`,
        Boolean(field.description?.value.trim()),
      );
    }
    return;
  }

  if (def.kind === Kind.INTERFACE_TYPE_DEFINITION) {
    const typeName = def.name.value;
    record(
      'outputType',
      file,
      typeName,
      !isPlaceholderDescription(typeName, def.description?.value ?? ''),
    );
    for (const field of def.fields ?? []) {
      if (isExemptFieldName(field.name.value)) continue;
      record(
        'outputField',
        file,
        `${typeName}.${field.name.value}`,
        Boolean(field.description?.value.trim()),
      );
    }
    return;
  }

  if (def.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) {
    const typeName = def.name.value;
    record(
      'inputType',
      file,
      typeName,
      !isPlaceholderDescription(typeName, def.description?.value ?? ''),
    );
    for (const field of def.fields ?? []) {
      if (isExemptFieldName(field.name.value)) continue;
      record(
        'inputField',
        file,
        `${typeName}.${field.name.value}`,
        Boolean(field.description?.value.trim()),
      );
    }
    return;
  }

  if (def.kind === Kind.ENUM_TYPE_DEFINITION) {
    const typeName = def.name.value;
    record(
      'enumType',
      file,
      typeName,
      !isPlaceholderDescription(typeName, def.description?.value ?? ''),
    );
    for (const value of def.values ?? []) {
      record(
        'enumValue',
        file,
        `${typeName}.${value.name.value}`,
        Boolean(value.description?.value.trim()),
      );
    }
  }
}

export function percentOf(stat: CategoryStat): number {
  if (stat.total === 0) return 100;
  return (stat.documented / stat.total) * 100;
}

export interface Violation {
  category: Category;
  actual: number;
  threshold: number;
  missing: string[];
}

/**
 * 임계치 미달 항목을 돌려준다.
 *
 * 소수 셋째 자리에서 비교한다 — 임계치를 실측치로 고정하는 운용이라
 * 부동소수 오차로 자기 자신에게 걸리는 걸 막아야 한다.
 */
export function findViolations(
  coverage: Coverage,
  thresholds: Record<Category, number>,
): Violation[] {
  const violations: Violation[] = [];
  for (const category of CATEGORIES) {
    const stat = coverage[category];
    const actual = percentOf(stat);
    const threshold = thresholds[category];
    if (actual + 1e-9 < threshold) {
      violations.push({
        category,
        actual,
        threshold,
        missing: stat.missing,
      });
    }
  }
  return violations;
}
