// 소유권 검사기의 입력 공간을 코드에서 읽어 온다 — 스키마의 relation, src/features의 Prisma write 호출, 경계를 넘는 read.
// 검사는 "어느 feature 파일에 물리 사이트가 있는가"로 판정한다(tx 클라이언트를 배럴 함수로 넘겨 소유 feature 안에서 write하는 것은 허용).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import * as ts from 'typescript';

import { FEATURE_SERVICE, MODEL_OWNERSHIP } from '@/test/model-ownership';

const REPO_ROOT = join(__dirname, '..', '..');
const FEATURES_DIR = join(REPO_ROOT, 'src', 'features');
const SCHEMA_PATH = join(REPO_ROOT, 'prisma', 'schema.prisma');

const WRITE_METHODS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);
const NESTED_WRITE_KEYS = new Set([...WRITE_METHODS, 'connectOrCreate']);
const RECEIVERS = new Set(['tx', 'prisma', 'db', 'client']);

export interface SchemaInfo {
  models: string[];
  tableOf: Record<string, string>;
  /** model → relation field → target model */
  relations: Record<string, Record<string, string>>;
}

export function loadSchema(): SchemaInfo {
  const text = readFileSync(SCHEMA_PATH, 'utf8');
  const blocks = [...text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const models = blocks.map((m) => m[1]);
  const modelSet = new Set(models);
  const tableOf: Record<string, string> = {};
  const relations: Record<string, Record<string, string>> = {};
  for (const [, name, body] of blocks) {
    tableOf[name] = /@@map\("(\w+)"\)/.exec(body)?.[1] ?? name;
    relations[name] = {};
    for (const line of body.split('\n')) {
      const field = /^\s+(\w+)\s+(\w+)(\[\])?\??(\s|$)/.exec(line);
      if (field && modelSet.has(field[2])) relations[name][field[1]] = field[2];
    }
  }
  return { models, tableOf, relations };
}

export function accessorToModel(accessor: string): string {
  return accessor.charAt(0).toUpperCase() + accessor.slice(1);
}

export function featureOf(
  file: string,
  featuresDir: string = FEATURES_DIR,
): string {
  return relative(featuresDir, file).split('/')[0];
}

export function listFeatureSources(dir: string = FEATURES_DIR): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFeatureSources(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
      files.push(full);
  }
  return files.sort();
}

export interface WriteSite {
  file: string;
  feature: string;
  model: string;
  method: string;
  line: number;
  nested: boolean;
}

function isReceiver(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) return RECEIVERS.has(expr.text);
  if (
    ts.isPropertyAccessExpression(expr) &&
    expr.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return RECEIVERS.has(expr.name.text);
  }
  return false;
}

/** `receiver.<model>.<method>(...)` 꼴이면 { model, method }를 돌려준다. */
function prismaCall(
  node: ts.Node,
): { model: string; method: string; call: ts.CallExpression } | null {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  )
    return null;
  const methodAccess = node.expression;
  if (!ts.isPropertyAccessExpression(methodAccess.expression)) return null;
  const modelAccess = methodAccess.expression;
  if (!isReceiver(modelAccess.expression)) return null;
  const model = accessorToModel(modelAccess.name.text);
  if (!(model in MODEL_OWNERSHIP)) return null;
  return { model, method: methodAccess.name.text, call: node };
}

function propName(prop: ts.ObjectLiteralElementLike): string | null {
  if (!prop.name) return null;
  if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
    return prop.name.text;
  return null;
}

/** 식별자는 스코프를 거슬러 올라가 `const X = {...}` 선언을 찾고, 조건식은 양쪽 분기를 모두 후보로 돌려준다 — include/select/where 상수를 따라가기 위해. */
function findDeclaration(id: ts.Identifier): ts.Expression | undefined {
  for (
    let scope: ts.Node | undefined = id.parent;
    scope;
    scope = scope.parent
  ) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const stmt of scope.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === id.text)
          return decl.initializer;
      }
    }
  }
  return undefined;
}

function resolveObjects(
  expr: ts.Expression | undefined,
  depth = 0,
): ts.ObjectLiteralExpression[] {
  if (!expr || depth > 8) return [];
  if (ts.isObjectLiteralExpression(expr)) return [expr];
  if (
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isParenthesizedExpression(expr)
  ) {
    return resolveObjects(expr.expression, depth + 1);
  }
  if (ts.isConditionalExpression(expr)) {
    return [
      ...resolveObjects(expr.whenTrue, depth + 1),
      ...resolveObjects(expr.whenFalse, depth + 1),
    ];
  }
  if (ts.isIdentifier(expr))
    return resolveObjects(findDeclaration(expr), depth + 1);
  return [];
}

function objectValues(
  prop: ts.ObjectLiteralElementLike,
): ts.ObjectLiteralExpression[] {
  if (ts.isPropertyAssignment(prop)) return resolveObjects(prop.initializer);
  if (ts.isShorthandPropertyAssignment(prop)) return resolveObjects(prop.name);
  return [];
}

/** `{ ...X, a: 1 }` — 스프레드된 상수 객체의 프로퍼티까지 평탄화한다. */
function propertiesOf(
  obj: ts.ObjectLiteralExpression,
): ts.ObjectLiteralElementLike[] {
  const props: ts.ObjectLiteralElementLike[] = [];
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      for (const spread of resolveObjects(prop.expression))
        props.push(...propertiesOf(spread));
      continue;
    }
    props.push(prop);
  }
  return props;
}

/** data 안의 relation 키 아래 create/createMany/... 를 nested write로 센다(관계 체인을 따라 모델을 바꿔 가며). */
function collectNestedWrites(
  obj: ts.ObjectLiteralExpression,
  model: string,
  schema: SchemaInfo,
  sf: ts.SourceFile,
  out: Omit<WriteSite, 'file' | 'feature'>[],
): void {
  for (const prop of propertiesOf(obj)) {
    const name = propName(prop);
    if (!name) continue;
    const target = schema.relations[model]?.[name];
    for (const value of objectValues(prop)) {
      if (!target) {
        collectNestedWrites(value, model, schema, sf, out);
        continue;
      }
      for (const inner of propertiesOf(value)) {
        const innerName = propName(inner);
        if (!innerName || !NESTED_WRITE_KEYS.has(innerName)) continue;
        out.push({
          model: target,
          method: `nested ${innerName}`,
          line: sf.getLineAndCharacterOfPosition(inner.getStart(sf)).line + 1,
          nested: true,
        });
        for (const innerValue of objectValues(inner))
          collectNestedWrites(innerValue, target, schema, sf, out);
      }
    }
  }
}

export function collectWriteSites(
  schema: SchemaInfo,
  featuresDir: string = FEATURES_DIR,
  files: string[] = listFeatureSources(featuresDir),
): WriteSite[] {
  const sites: WriteSite[] = [];
  for (const file of files) {
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ES2022,
      true,
    );
    const feature = featureOf(file, featuresDir);
    const visit = (node: ts.Node): void => {
      const found = prismaCall(node);
      if (found && WRITE_METHODS.has(found.method)) {
        const line =
          sf.getLineAndCharacterOfPosition(found.call.getStart(sf)).line + 1;
        sites.push({
          file,
          feature,
          model: found.model,
          method: found.method,
          line,
          nested: false,
        });
        const nested: Omit<WriteSite, 'file' | 'feature'>[] = [];
        for (const arg of found.call.arguments) {
          if (ts.isObjectLiteralExpression(arg))
            collectNestedWrites(arg, found.model, schema, sf, nested);
        }
        sites.push(...nested.map((n) => ({ ...n, file, feature })));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites;
}

export function isAllowedWriter(site: WriteSite): boolean {
  return MODEL_OWNERSHIP[site.model].writers.includes(site.feature);
}

export interface CrossRead {
  file: string;
  kind: 'nested' | 'filter' | 'raw';
  /** nested/filter: `Root.path->Target`, raw: `method:table,table` */
  key: string;
}

function serviceOfModel(model: string): string {
  return MODEL_OWNERSHIP[model].service;
}

const FILTER_WRAPPERS = new Set(['some', 'every', 'none', 'is', 'isNot']);
const LOGICAL_KEYS = new Set(['AND', 'OR', 'NOT']);

function arrayObjects(
  expr: ts.Expression | undefined,
): ts.ObjectLiteralExpression[] {
  if (expr && ts.isArrayLiteralExpression(expr))
    return expr.elements.flatMap((el) => resolveObjects(el));
  return resolveObjects(expr);
}

/** where 객체: relation 키(직접 또는 some/is 래퍼)가 다른 서비스면 filter로 기록하고 그 안으로 내려간다. */
function collectWhereReads(
  obj: ts.ObjectLiteralExpression,
  model: string,
  rootService: string,
  path: string,
  schema: SchemaInfo,
  out: Set<string>,
): void {
  for (const prop of propertiesOf(obj)) {
    const name = propName(prop);
    if (!name) continue;
    const initializer = ts.isPropertyAssignment(prop)
      ? prop.initializer
      : ts.isShorthandPropertyAssignment(prop)
        ? prop.name
        : undefined;
    if (LOGICAL_KEYS.has(name)) {
      for (const el of arrayObjects(initializer))
        collectWhereReads(el, model, rootService, path, schema, out);
      continue;
    }
    const target = schema.relations[model]?.[name];
    if (!target) continue;
    const nextPath = `${path}.${name}`;
    if (serviceOfModel(target) !== rootService)
      out.add(`filter:${nextPath}->${target}`);
    for (const value of objectValues(prop)) {
      const wrapped = propertiesOf(value).filter((inner) => {
        const innerName = propName(inner);
        return innerName !== null && FILTER_WRAPPERS.has(innerName);
      });
      const scopes =
        wrapped.length > 0
          ? wrapped.flatMap((inner) => objectValues(inner))
          : [value];
      for (const scope of scopes)
        collectWhereReads(scope, target, rootService, nextPath, schema, out);
    }
  }
}

/** 쿼리 객체를 relation을 따라 내려가며 다른 서비스 모델로 나가는 include/select/_count/orderBy(nested)와 where(filter)를 모은다. */
function collectCrossReads(
  obj: ts.ObjectLiteralExpression,
  model: string,
  rootService: string,
  path: string,
  schema: SchemaInfo,
  out: Set<string>,
): void {
  for (const prop of propertiesOf(obj)) {
    const name = propName(prop);
    if (!name || name === 'data') continue;
    const values = objectValues(prop);
    if (name === 'where') {
      for (const value of values)
        collectWhereReads(value, model, rootService, path, schema, out);
      continue;
    }
    if (name === 'include' || name === 'select' || name === 'orderBy') {
      const initializer = ts.isPropertyAssignment(prop)
        ? prop.initializer
        : undefined;
      for (const value of name === 'orderBy'
        ? arrayObjects(initializer)
        : values) {
        for (const inner of propertiesOf(value)) {
          const rel = propName(inner);
          if (!rel) continue;
          if (rel === '_count') {
            for (const countObj of objectValues(inner)) {
              const sel = propertiesOf(countObj).find(
                (p) => propName(p) === 'select',
              );
              for (const selObj of sel ? objectValues(sel) : []) {
                for (const c of propertiesOf(selObj)) {
                  const cRel = propName(c);
                  const cTarget = cRel
                    ? schema.relations[model]?.[cRel]
                    : undefined;
                  if (cTarget && serviceOfModel(cTarget) !== rootService) {
                    out.add(`nested:${path}._count.${cRel}->${cTarget}`);
                  }
                }
              }
            }
            continue;
          }
          const target = schema.relations[model]?.[rel];
          if (!target) continue;
          const nextPath = `${path}.${rel}`;
          if (serviceOfModel(target) !== rootService)
            out.add(`nested:${nextPath}->${target}`);
          for (const innerObj of objectValues(inner))
            collectCrossReads(
              innerObj,
              target,
              rootService,
              nextPath,
              schema,
              out,
            );
        }
      }
      continue;
    }
    for (const value of values)
      collectCrossReads(value, model, rootService, path, schema, out);
  }
}

function enclosingMethodName(node: ts.Node): string {
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (
      (ts.isMethodDeclaration(cur) || ts.isFunctionDeclaration(cur)) &&
      cur.name &&
      ts.isIdentifier(cur.name)
    ) {
      return cur.name.text;
    }
    if (ts.isPropertyDeclaration(cur) && ts.isIdentifier(cur.name))
      return cur.name.text;
    cur = cur.parent;
  }
  return '(module)';
}

function rawTables(text: string, schema: SchemaInfo): string[] {
  return schema.models
    .map((m) => schema.tableOf[m])
    .filter((table) => new RegExp(`\\b${table}\\b`).test(text))
    .sort();
}

export function collectCrossReadsInFeatures(
  schema: SchemaInfo,
  featuresDir: string = FEATURES_DIR,
  files: string[] = listFeatureSources(featuresDir),
): CrossRead[] {
  const reads: CrossRead[] = [];
  const tableService = new Map(
    schema.models.map((m) => [schema.tableOf[m], serviceOfModel(m)]),
  );
  for (const file of files) {
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ES2022,
      true,
    );
    const feature = featureOf(file, featuresDir);
    const fileService = FEATURE_SERVICE[feature];
    const keys = new Set<string>();
    const visit = (node: ts.Node): void => {
      const found = prismaCall(node);
      if (found) {
        const rootService = serviceOfModel(found.model);
        for (const arg of found.call.arguments) {
          if (ts.isObjectLiteralExpression(arg))
            collectCrossReads(
              arg,
              found.model,
              rootService,
              found.model,
              schema,
              keys,
            );
        }
      }
      // raw SQL: 파일 feature의 서비스와 다른 서비스 테이블이 섞이면 cross. 행위자 feature는 첫 테이블의 서비스를 기준으로 본다.
      if (
        ts.isTaggedTemplateExpression(node) &&
        /\$(queryRaw|executeRaw)$|\bsql$/.test(node.tag.getText(sf))
      ) {
        const tables = rawTables(node.template.getText(sf), schema);
        const services = new Set(tables.map((t) => tableService.get(t)));
        const base = fileService ?? tableService.get(tables[0] ?? '');
        if (tables.length > 0 && [...services].some((s) => s !== base)) {
          keys.add(`raw:${enclosingMethodName(node)}:${tables.join(',')}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    for (const key of [...keys].sort()) {
      const [kind] = key.split(':') as [CrossRead['kind']];
      reads.push({
        file: relative(
          featuresDir === FEATURES_DIR ? REPO_ROOT : featuresDir,
          file,
        ),
        kind,
        key: key.slice(kind.length + 1),
      });
    }
  }
  return reads;
}

export function relPath(file: string): string {
  return relative(REPO_ROOT, file);
}
