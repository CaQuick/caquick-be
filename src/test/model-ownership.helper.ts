// 소유권 검사기의 입력 공간을 코드에서 읽어 온다 — 스키마의 relation, src/features의 Prisma write 호출, 경계를 넘는 read.
// 검사는 "어느 feature 파일에 물리 사이트가 있는가"로 판정한다(tx 클라이언트를 배럴 함수로 넘겨 소유 feature 안에서 write하는 것은 허용).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

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

/** src/features 바로 아래 디렉터리 이름 — feature→서비스 매핑의 정합성 검사용. */
export function listFeatureDirs(dir: string = FEATURES_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
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

/** 식별자는 스코프를 거슬러 올라가 `const X = {...}`·함수 선언을 찾고, 없으면 import를 따라 다른 파일의 export까지 본다. */
function findDeclaration(id: ts.Identifier): ts.Node | undefined {
  for (
    let scope: ts.Node | undefined = id.parent;
    scope;
    scope = scope.parent
  ) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    const found = findInStatements(scope.statements, id.text);
    if (found) return found;
  }
  return findImported(id.getSourceFile(), id.text, 0);
}

function findInStatements(
  statements: ts.NodeArray<ts.Statement>,
  name: string,
): ts.Node | undefined {
  for (const stmt of statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) return stmt;
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name)
        return decl.initializer;
    }
  }
  return undefined;
}

const moduleCache = new Map<string, ts.SourceFile | null>();

/** `@/x` → src/x, `./x` → 상대 경로. `.ts` 또는 `/index.ts`. */
function loadModule(fromFile: string, specifier: string): ts.SourceFile | null {
  const base = specifier.startsWith('@/')
    ? join(REPO_ROOT, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (!moduleCache.has(candidate)) {
      moduleCache.set(
        candidate,
        existsSync(candidate)
          ? ts.createSourceFile(
              candidate,
              readFileSync(candidate, 'utf8'),
              ts.ScriptTarget.ES2022,
              true,
            )
          : null,
      );
    }
    const sf = moduleCache.get(candidate);
    if (sf) return sf;
  }
  return null;
}

const REEXPORT_DEPTH = 4;

/** `import { X [as Y] } from '...'`를 따라 모듈의 export 선언을 찾는다. */
function findImported(
  sf: ts.SourceFile,
  name: string,
  depth: number,
): ts.Node | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (
      !bindings ||
      !ts.isNamedImports(bindings) ||
      !ts.isStringLiteral(stmt.moduleSpecifier)
    )
      continue;
    const el = bindings.elements.find((e) => e.name.text === name);
    if (!el) continue;
    const mod = loadModule(sf.fileName, stmt.moduleSpecifier.text);
    return mod
      ? findExported(mod, (el.propertyName ?? el.name).text, depth + 1)
      : undefined;
  }
  return undefined;
}

/** 모듈의 최상위 선언, 없으면 `export { X } from` / `export * from` 재export를 따라간다. */
function findExported(
  sf: ts.SourceFile,
  name: string,
  depth: number,
): ts.Node | undefined {
  if (depth > REEXPORT_DEPTH) return undefined;
  const local = findInStatements(sf.statements, name);
  if (local) return local;
  for (const stmt of sf.statements) {
    if (
      !ts.isExportDeclaration(stmt) ||
      !stmt.moduleSpecifier ||
      !ts.isStringLiteral(stmt.moduleSpecifier)
    )
      continue;
    const mod = loadModule(sf.fileName, stmt.moduleSpecifier.text);
    if (!mod) continue;
    if (!stmt.exportClause) {
      const found = findExported(mod, name, depth + 1);
      if (found) return found;
      continue;
    }
    if (!ts.isNamedExports(stmt.exportClause)) continue;
    const el = stmt.exportClause.elements.find((e) => e.name.text === name);
    if (el)
      return findExported(mod, (el.propertyName ?? el.name).text, depth + 1);
  }
  return undefined;
}

/** `this.x` / `this.x()` — 같은 클래스의 멤버(메서드·getter·프로퍼티) 선언. */
function findClassMember(
  access: ts.PropertyAccessExpression,
): ts.ClassElement | undefined {
  if (access.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  let node: ts.Node | undefined = access;
  while (node && !ts.isClassLike(node)) node = node.parent;
  return node?.members.find(
    (m) =>
      m.name && ts.isIdentifier(m.name) && m.name.text === access.name.text,
  );
}

/** 함수 본문의 return 식(중첩 함수 안은 제외). 식 본문 화살표 함수는 그 식. */
function returnExpressions(fn: ts.Node): ts.Expression[] {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body];
  const body =
    ts.isFunctionLike(fn) && 'body' in fn && fn.body && ts.isBlock(fn.body)
      ? fn.body
      : undefined;
  if (!body) return [];
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression)
      out.push(node.expression);
    ts.forEachChild(node, visit);
  };
  visit(body);
  return out;
}

/** 멤버·선언이 만드는 객체: 메서드/getter/함수는 return 식, 프로퍼티는 초기값(화살표 함수면 그 본문). */
function objectsOfDeclaration(
  decl: ts.Node | undefined,
  depth: number,
): ts.ObjectLiteralExpression[] {
  if (!decl) return [];
  if (ts.isPropertyDeclaration(decl)) {
    const init = decl.initializer;
    if (!init) return [];
    return ts.isArrowFunction(init) || ts.isFunctionExpression(init)
      ? returnExpressions(init).flatMap((e) => resolveObjects(e, depth + 1))
      : resolveObjects(init, depth + 1);
  }
  if (ts.isFunctionLike(decl))
    return returnExpressions(decl).flatMap((e) => resolveObjects(e, depth + 1));
  return [];
}

const NULLISH_OR = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
]);

/**
 * 식이 만들 수 있는 객체 리터럴 후보. 조건식·`??`·`||`는 양쪽 분기 모두, 배열은 원소 전부,
 * 상수·클래스 멤버·헬퍼 함수(`this.visibleWhere(id)`, `buildArgs()`, `xs.map((x) => ({...}))`)는 본문의 return 식까지 따라간다.
 */
function resolveObjects(
  expr: ts.Node | undefined,
  depth = 0,
): ts.ObjectLiteralExpression[] {
  if (!expr || depth > 8) return [];
  const next = (e: ts.Node | undefined): ts.ObjectLiteralExpression[] =>
    resolveObjects(e, depth + 1);
  if (ts.isObjectLiteralExpression(expr)) return [expr];
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.flatMap(next);
  if (
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isParenthesizedExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isAwaitExpression(expr)
  ) {
    return next(expr.expression);
  }
  if (ts.isConditionalExpression(expr))
    return [...next(expr.whenTrue), ...next(expr.whenFalse)];
  if (ts.isBinaryExpression(expr) && NULLISH_OR.has(expr.operatorToken.kind))
    return [...next(expr.left), ...next(expr.right)];
  if (ts.isIdentifier(expr)) {
    const decl = findDeclaration(expr);
    return decl && ts.isFunctionDeclaration(decl) ? [] : next(decl);
  }
  if (ts.isPropertyAccessExpression(expr))
    return objectsOfDeclaration(findClassMember(expr), depth);
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === 'map') {
        const fn = expr.arguments[0];
        return fn && ts.isFunctionLike(fn)
          ? returnExpressions(fn).flatMap(next)
          : [];
      }
      return objectsOfDeclaration(findClassMember(callee), depth);
    }
    if (ts.isIdentifier(callee))
      return objectsOfDeclaration(findDeclaration(callee), depth);
  }
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

function lineOf(node: ts.Node): number {
  const sf = node.getSourceFile();
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** data 안의 relation 키 아래 create/createMany/... 를 nested write로 센다(관계 체인을 따라 모델을 바꿔 가며). */
function collectNestedWrites(
  obj: ts.ObjectLiteralExpression,
  model: string,
  schema: SchemaInfo,
  out: Omit<WriteSite, 'file' | 'feature'>[],
): void {
  for (const prop of propertiesOf(obj)) {
    const name = propName(prop);
    if (!name) continue;
    const target = schema.relations[model]?.[name];
    for (const value of objectValues(prop)) {
      if (!target) {
        collectNestedWrites(value, model, schema, out);
        continue;
      }
      for (const inner of propertiesOf(value)) {
        const innerName = propName(inner);
        if (!innerName || !NESTED_WRITE_KEYS.has(innerName)) continue;
        out.push({
          model: target,
          method: `nested ${innerName}`,
          line: lineOf(inner),
          nested: true,
        });
        for (const innerValue of objectValues(inner))
          collectNestedWrites(innerValue, target, schema, out);
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
        // 인자를 상수로 넘기는 호출(prisma.x.create(args))도 같은 규칙으로 본다
        for (const arg of found.call.arguments) {
          for (const obj of resolveObjects(arg))
            collectNestedWrites(obj, found.model, schema, nested);
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
  kind: 'nested' | 'filter' | 'raw' | 'opaque';
  /** nested/filter: `Root.path->Target`, raw: `method:table,table`, opaque: `method:Root.path=식` */
  key: string;
}

function serviceOfModel(model: string): string {
  return MODEL_OWNERSHIP[model].service;
}

const FILTER_WRAPPERS = new Set(['some', 'every', 'none', 'is', 'isNot']);
const LOGICAL_KEYS = new Set(['AND', 'OR', 'NOT']);

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
      for (const el of resolveObjects(initializer))
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
        ? resolveObjects(initializer)
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

const STRUCTURAL_KEYS = new Set([
  'where',
  'include',
  'select',
  'orderBy',
  'data',
  ...NESTED_WRITE_KEYS,
  ...FILTER_WRAPPERS,
  ...LOGICAL_KEYS,
]);

/** 리터럴·enum 멤버·`new Date()`처럼 relation을 숨길 수 없는 값. */
function isScalarLike(expr: ts.Expression): boolean {
  if (ts.isArrayLiteralExpression(expr))
    return expr.elements.every((el) => isScalarLike(el));
  return (
    ts.isLiteralExpression(expr) ||
    ts.isTemplateExpression(expr) ||
    ts.isPrefixUnaryExpression(expr) ||
    ts.isNewExpression(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expr) && expr.text === 'undefined')
  );
}

/**
 * 구조 키(where/include/select/data/...)·relation 키 자리와 spread에 놓인 식이 객체 리터럴로 풀리지 않으면 opaque로 기록한다.
 * 파라미터 pass-through(`data: args.data`)처럼 검사기가 볼 수 없는 자리를 허용 목록으로 고정해, 새 불투명 자리가 생기면 실패하게 한다.
 */
function collectOpaque(
  expr: ts.Expression,
  model: string,
  path: string,
  schema: SchemaInfo,
  out: Set<string>,
  method: string,
): void {
  const objects = resolveObjects(expr);
  if (objects.length === 0) {
    if (!isScalarLike(expr)) {
      const text = expr
        .getText(expr.getSourceFile())
        .replace(/\s+/g, ' ')
        .slice(0, 60);
      out.add(`opaque:${method}:${path}=${text}`);
    }
    return;
  }
  for (const obj of objects) {
    for (const prop of obj.properties) {
      if (ts.isSpreadAssignment(prop)) {
        collectOpaque(prop.expression, model, path, schema, out, method);
        continue;
      }
      const name = propName(prop);
      const value = ts.isPropertyAssignment(prop)
        ? prop.initializer
        : ts.isShorthandPropertyAssignment(prop)
          ? prop.name
          : undefined;
      if (!name || !value) continue;
      const target = schema.relations[model]?.[name];
      if (target)
        collectOpaque(value, target, `${path}.${name}`, schema, out, method);
      else if (STRUCTURAL_KEYS.has(name))
        collectOpaque(value, model, `${path}.${name}`, schema, out, method);
    }
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
        const method = enclosingMethodName(node);
        for (const arg of found.call.arguments) {
          collectOpaque(arg, found.model, found.model, schema, keys, method);
          for (const obj of resolveObjects(arg))
            collectCrossReads(
              obj,
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
