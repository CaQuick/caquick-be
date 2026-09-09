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

import type {
  DefinitionNode,
  DocumentNode,
  FieldDefinitionNode,
  InputValueDefinitionNode,
} from 'graphql';
import { Kind, parse } from 'graphql';

/** 문서 트리 깊이 순. 게이트 출력도 이 순서를 따른다. */
export const CATEGORIES = [
  'rootField',
  'fieldArg',
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
  fieldArg: '필드 인자(비 input)',
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
 * 의도적으로 집계하지 않는 정의 종류.
 *
 * schema 선언은 루트 타입을 이름짓는 배선일 뿐 프론트가 소비하는 API 요소가 아니다.
 * scalar·union·directive 확장은 설명을 붙일 자리가 없다(각각 directive·멤버·인자만 더한다).
 * 실행 문서(query/fragment)는 SDL 파일에 오지 않지만 파서가 같은 문법을 받으므로 함께 둔다.
 */
export const IGNORED_KINDS = new Set<string>([
  Kind.SCHEMA_DEFINITION,
  Kind.SCHEMA_EXTENSION,
  Kind.SCALAR_TYPE_EXTENSION,
  Kind.UNION_TYPE_EXTENSION,
  Kind.DIRECTIVE_EXTENSION,
  Kind.OPERATION_DEFINITION,
  Kind.FRAGMENT_DEFINITION,
]);

/**
 * 이름만으로 의미가 자명해 설명을 요구하지 않는 필드. 분모에서 빠질 뿐 작성을 막지 않는다.
 *
 * 전부 채우게 하면 "상품 ID" 같은 무의미한 설명만 늘어난다. 반대로 목록을 넓히면
 * 설명이 필요한 자리를 가리므로(`quantity`는 단위·상한이 필요할 수 있어 넣지 않았다)
 * 이름만으로 대상이 특정되는 것에 한정한다.
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
 * `"""SellerOrderSummary 타입"""`처럼 이름만 되풀이하는 설명은 파서에 "문서화됨"으로
 * 잡히지만 전달되는 정보가 없다. 미기재로 세지 않으면 기준선이 거짓 안전을 준다.
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

/**
 * SDL에 선언된 input 객체 타입명을 모은다. 인자 집계는 "input 객체가 아니면 대상"으로
 * 판정하므로, 커스텀 스칼라나 enum 타입 인자가 추가돼도 목록을 손대지 않아도 된다.
 */
function collectInputTypeNames(documents: DocumentNode[]): Set<string> {
  const names = new Set<string>();
  for (const doc of documents) {
    for (const def of doc.definitions) {
      if (
        def.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ||
        def.kind === Kind.INPUT_OBJECT_TYPE_EXTENSION
      ) {
        names.add(def.name.value);
      }
    }
  }
  return names;
}

export function collectCoverage(files: SdlFile[]): Coverage {
  const coverage = emptyCoverage();
  const documents = files.map((file) => parse(file.sdl));
  const inputTypeNames = collectInputTypeNames(documents);

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

  files.forEach(({ path }, index) => {
    for (const def of documents[index].definitions) {
      collectDefinition(def, path, record, inputTypeNames);
    }
  });

  return coverage;
}

type Recorder = (
  category: Category,
  file: string,
  label: string,
  hasDescription: boolean,
) => void;

/**
 * 필드 인자를 기록한다. 루트든 아니든 인자는 설명을 적을 자리가 인자뿐이라 규칙이 같다.
 *
 * input 객체 인자만 제외한다 — 그쪽은 input 타입 선언·필드에 설명을 두면 된다.
 */
function recordFieldArgs(
  field: FieldDefinitionNode,
  ownerLabel: string,
  file: string,
  record: Recorder,
  inputTypeNames: Set<string>,
): void {
  for (const arg of field.arguments ?? []) {
    if (inputTypeNames.has(namedTypeOf(arg))) continue;
    if (isExemptFieldName(arg.name.value)) continue;
    record(
      'fieldArg',
      file,
      `${ownerLabel}.${field.name.value}(${arg.name.value})`,
      Boolean(arg.description?.value.trim()),
    );
  }
}

/** 출력 타입(object·interface)의 필드와 그 인자를 기록한다. 정의든 확장이든 규칙이 같다. */
function recordOutputFields(
  fields: readonly FieldDefinitionNode[] | undefined,
  typeName: string,
  file: string,
  record: Recorder,
  inputTypeNames: Set<string>,
): void {
  for (const field of fields ?? []) {
    recordFieldArgs(field, typeName, file, record, inputTypeNames);
    if (isExemptFieldName(field.name.value)) continue;
    record(
      'outputField',
      file,
      `${typeName}.${field.name.value}`,
      Boolean(field.description?.value.trim()),
    );
  }
}

/** 선언 설명은 정의에만 붙는다 — 확장 노드는 필드·값만 센다. */
function recordTypeDeclaration(
  category: Category,
  typeName: string,
  file: string,
  description: string | undefined,
  record: Recorder,
): void {
  record(
    category,
    file,
    typeName,
    !isPlaceholderDescription(typeName, description ?? ''),
  );
}

export function collectDefinition(
  def: DefinitionNode,
  file: string,
  record: Recorder,
  inputTypeNames: Set<string>,
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
        recordFieldArgs(field, typeName, file, record, inputTypeNames);
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
    recordOutputFields(def.fields, typeName, file, record, inputTypeNames);
    return;
  }

  if (
    def.kind === Kind.INTERFACE_TYPE_DEFINITION ||
    def.kind === Kind.INTERFACE_TYPE_EXTENSION
  ) {
    const typeName = def.name.value;
    // 확장에는 타입 선언 설명을 붙일 수 없으므로 선언은 정의에서만 센다.
    if (def.kind === Kind.INTERFACE_TYPE_DEFINITION) {
      record(
        'outputType',
        file,
        typeName,
        !isPlaceholderDescription(typeName, def.description?.value ?? ''),
      );
    }
    recordOutputFields(def.fields, typeName, file, record, inputTypeNames);
    return;
  }

  if (
    def.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ||
    def.kind === Kind.INPUT_OBJECT_TYPE_EXTENSION
  ) {
    const typeName = def.name.value;
    if (def.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) {
      record(
        'inputType',
        file,
        typeName,
        !isPlaceholderDescription(typeName, def.description?.value ?? ''),
      );
    }
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

  // directive는 선언 설명과 인자 설명이 유일한 문서다.
  if (def.kind === Kind.DIRECTIVE_DEFINITION) {
    const typeName = def.name.value;
    record(
      'outputType',
      file,
      `@${typeName}`,
      !isPlaceholderDescription(typeName, def.description?.value ?? ''),
    );
    for (const arg of def.arguments ?? []) {
      if (inputTypeNames.has(namedTypeOf(arg))) continue;
      if (isExemptFieldName(arg.name.value)) continue;
      record(
        'fieldArg',
        file,
        `@${typeName}(${arg.name.value})`,
        Boolean(arg.description?.value.trim()),
      );
    }
    return;
  }

  // union·scalar는 필드가 없어 선언 설명이 유일한 문서다.
  if (
    def.kind === Kind.UNION_TYPE_DEFINITION ||
    def.kind === Kind.SCALAR_TYPE_DEFINITION
  ) {
    const typeName = def.name.value;
    record(
      'outputType',
      file,
      typeName,
      !isPlaceholderDescription(typeName, def.description?.value ?? ''),
    );
    return;
  }

  if (
    def.kind === Kind.ENUM_TYPE_DEFINITION ||
    def.kind === Kind.ENUM_TYPE_EXTENSION
  ) {
    const typeName = def.name.value;
    if (def.kind === Kind.ENUM_TYPE_DEFINITION) {
      record(
        'enumType',
        file,
        typeName,
        !isPlaceholderDescription(typeName, def.description?.value ?? ''),
      );
    }
    for (const value of def.values ?? []) {
      record(
        'enumValue',
        file,
        `${typeName}.${value.name.value}`,
        Boolean(value.description?.value.trim()),
      );
    }
    return;
  }

  if (IGNORED_KINDS.has(def.kind)) return;

  // 모르는 SDL 구문. 조용히 넘기면 그 구문으로 추가된 요소가 집계에서 통째로 빠져
  // 게이트가 무력화되므로, 분류를 강제하기 위해 실패시킨다.
  throw new Error(
    `[docs:check] 처리하지 않은 SDL 정의 종류: ${def.kind} (${file}). ` +
      '집계 대상이면 collectDefinition에, 아니면 IGNORED_KINDS에 근거와 함께 추가하라.',
  );
}

export function percentOf(stat: CategoryStat): number {
  if (stat.total === 0) return 100;
  return (stat.documented / stat.total) * 100;
}

export interface Baseline {
  documented: number;
  total: number;
}

export interface Violation {
  category: Category;
  /** 'ratio' 커버리지 비율 하락 · 'count' 미기재 건수 증가 */
  reason: 'ratio' | 'count';
  actual: number;
  threshold: number;
  actualMissing: number;
  baselineMissing: number;
  missing: string[];
}

export function missingCountOf(baseline: Baseline): number {
  return baseline.total - baseline.documented;
}

/**
 * 기준선 대비 회귀를 찾는다. 두 조건을 함께 건다.
 *
 * 1. 미기재 건수가 기준선보다 늘면 실패.
 * 2. 커버리지 비율이 기준선보다 떨어지면 실패.
 *
 * 왜 둘 다인가: 비율만 보면 기준선이 0%인 카테고리를 영영 못 막는다
 * (0/6 → 0/7도 0% >= 0%라 통과). 건수만 보면 설명이 있던 필드를 지워 비율이
 * 떨어지는 회귀를 놓친다.
 *
 * 비율 비교는 소수 여유(1e-9)를 둔다 — 기준선을 실측 분수로 고정하는 운용이라
 * 부동소수 오차로 자기 자신에게 걸리면 안 된다.
 */
export function findViolations(
  coverage: Coverage,
  baselines: Record<Category, Baseline>,
): Violation[] {
  const violations: Violation[] = [];
  for (const category of CATEGORIES) {
    const stat = coverage[category];
    const baseline = baselines[category];
    const actual = percentOf(stat);
    const threshold = percentOf({ ...baseline, missing: [] });
    const actualMissing = stat.missing.length;
    const baselineMissing = missingCountOf(baseline);

    const base = {
      category,
      actual,
      threshold,
      actualMissing,
      baselineMissing,
      missing: stat.missing,
    };

    if (actualMissing > baselineMissing) {
      violations.push({ ...base, reason: 'count' });
      continue;
    }
    if (actual + 1e-9 < threshold) {
      violations.push({ ...base, reason: 'ratio' });
    }
  }
  return violations;
}
