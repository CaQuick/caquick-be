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
/** relation 재연결 — FK 컬럼을 상대 모델이 가지면(inverse 측) 상대 row를 고치는 write다. */
const RELINK_KEYS = new Set(['connect', 'disconnect', 'set']);
/** Prisma delegate 메서드. `<수신자>.<model>.<메서드>(` 꼴이면 수신자 이름과 무관하게 Prisma 호출로 본다(`trx`·`client` 등 어떤 이름이든). */
const DELEGATE_METHODS = new Set([
  ...WRITE_METHODS,
  'createManyAndReturn',
  'updateManyAndReturn',
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

export interface SchemaInfo {
  models: string[];
  tableOf: Record<string, string>;
  /** model → relation field → target model */
  relations: Record<string, Record<string, string>>;
  /** model → relation field → { list: `[]` 관계, fkOwner: 이 모델이 FK 컬럼을 가짐(`@relation(fields: ...)`) } */
  relationMeta: Record<
    string,
    Record<string, { list: boolean; fkOwner: boolean }>
  >;
}

export function loadSchema(): SchemaInfo {
  const text = readFileSync(SCHEMA_PATH, 'utf8');
  const blocks = [...text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const models = blocks.map((m) => m[1]);
  const modelSet = new Set(models);
  const tableOf: Record<string, string> = {};
  const relations: Record<string, Record<string, string>> = {};
  const relationMeta: SchemaInfo['relationMeta'] = {};
  for (const [, name, body] of blocks) {
    tableOf[name] = /@@map\("(\w+)"\)/.exec(body)?.[1] ?? name;
    relations[name] = {};
    relationMeta[name] = {};
    for (const line of body.split('\n')) {
      const field = /^\s+(\w+)\s+(\w+)(\[\])?\??(\s|$)/.exec(line);
      if (!field || !modelSet.has(field[2])) continue;
      relations[name][field[1]] = field[2];
      relationMeta[name][field[1]] = {
        list: field[3] === '[]',
        fkOwner: /@relation\([^)]*fields:/.test(line),
      };
    }
  }
  return { models, tableOf, relations, relationMeta };
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

/** `<수신자>.<model 접근자>.<delegate 메서드>(...)` 꼴이면 { model, method }를 돌려준다. */
function prismaCall(
  node: ts.Node,
): { model: string; method: string; call: ts.CallExpression } | null {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  )
    return null;
  const methodAccess = node.expression;
  if (!DELEGATE_METHODS.has(methodAccess.name.text)) return null;
  if (!ts.isPropertyAccessExpression(methodAccess.expression)) return null;
  const model = accessorToModel(methodAccess.expression.name.text);
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

const NULLISH_OR = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
]);
const MAX_HOPS = 32;

/** 헬퍼를 따라 들어갈 때의 문맥: 호출 인자로 묶인 파라미터와 재귀 깊이. */
interface ResolveCtx {
  hops: number;
  bindings: ReadonlyMap<string, { expr: ts.Expression; ctx: ResolveCtx }>;
}
const ROOT_CTX: ResolveCtx = { hops: 0, bindings: new Map() };

/** 헬퍼 본문에서 나온 객체 리터럴이 어떤 바인딩 아래 있었는지 — 그 안쪽을 다시 풀 때 파라미터를 잇기 위해. */
const objectCtx = new WeakMap<ts.Node, ResolveCtx>();

function ctxOf(node: ts.Node | undefined): ResolveCtx {
  for (let cur = node; cur; cur = cur.parent) {
    const ctx = objectCtx.get(cur);
    if (ctx) return ctx;
  }
  return ROOT_CTX;
}

/** 호출 인자를 함수 파라미터 이름에 묶는다(구조 분해 파라미터는 묶지 않음, 빠진 인자는 기본값). */
function bindParams(
  fn: ts.SignatureDeclaration,
  args: readonly ts.Expression[],
  callerCtx: ResolveCtx,
): ResolveCtx {
  const bindings = new Map(callerCtx.bindings);
  fn.parameters.forEach((param, i) => {
    if (!ts.isIdentifier(param.name)) return;
    const arg = args[i];
    if (arg) bindings.set(param.name.text, { expr: arg, ctx: callerCtx });
    else if (param.initializer)
      bindings.set(param.name.text, {
        expr: param.initializer,
        ctx: { hops: callerCtx.hops + 1, bindings: new Map() },
      });
    else bindings.delete(param.name.text);
  });
  return { hops: callerCtx.hops + 1, bindings };
}

function callResults(
  fn: ts.Node | undefined,
  args: readonly ts.Expression[],
  callerCtx: ResolveCtx,
): ts.Expression[] {
  if (!fn) return [];
  const target =
    ts.isPropertyDeclaration(fn) &&
    fn.initializer &&
    (ts.isArrowFunction(fn.initializer) ||
      ts.isFunctionExpression(fn.initializer))
      ? fn.initializer
      : fn;
  if (!ts.isFunctionLike(target)) return [];
  const ctx = bindParams(target, args, callerCtx);
  return returnExpressions(target).flatMap((e) => constituents(e, ctx));
}

/**
 * 식이 실행 시 될 수 있는 값의 잎: 조건식·`??`·`||`는 양쪽, 배열은 원소 전부, 상수·클래스 멤버·헬퍼 함수
 * (`this.visibleWhere(id)`, `buildArgs()`, `xs.map((x) => ({...}))`)는 본문 return 식까지, 호출 인자는 파라미터에 묶어 따라간다.
 * 객체 리터럴로 풀리지 않는 잎(파라미터·외부 값)은 그대로 돌려줘 호출자가 opaque로 다루게 한다.
 */
function constituents(
  expr: ts.Node | undefined,
  ctx: ResolveCtx,
): ts.Expression[] {
  if (!expr) return [];
  if (ctx.hops > MAX_HOPS) return ts.isExpression(expr) ? [expr] : [];
  const next = (e: ts.Node | undefined): ts.Expression[] =>
    constituents(e, { ...ctx, hops: ctx.hops + 1 });
  if (ts.isObjectLiteralExpression(expr)) {
    if (ctx.bindings.size > 0) objectCtx.set(expr, ctx);
    return [expr];
  }
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
  // `flag && {...}` — 객체가 되는 쪽은 오른쪽뿐
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  )
    return next(expr.right);
  if (ts.isIdentifier(expr)) {
    const bound = ctx.bindings.get(expr.text);
    if (bound)
      return constituents(bound.expr, {
        ...bound.ctx,
        hops: ctx.hops + 1,
      });
    const decl = findDeclaration(expr);
    if (!decl || ts.isFunctionDeclaration(decl)) return [expr];
    return constituents(decl, { hops: ctx.hops + 1, bindings: new Map() });
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const member = findClassMember(expr);
    if (member && ts.isPropertyDeclaration(member) && member.initializer)
      return ts.isFunctionLike(member.initializer)
        ? [expr]
        : next(member.initializer);
    if (member && ts.isGetAccessorDeclaration(member))
      return callResults(member, [], ctx);
    return [expr];
  }
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === 'map') {
        const fn = expr.arguments[0];
        return fn && ts.isFunctionLike(fn)
          ? returnExpressions(fn).flatMap((e) =>
              constituents(e, bindParams(fn, [], ctx)),
            )
          : [expr];
      }
      const results = callResults(findClassMember(callee), expr.arguments, ctx);
      return findClassMember(callee) ? results : [expr];
    }
    if (ts.isIdentifier(callee)) {
      const decl = findDeclaration(callee);
      return decl ? callResults(decl, expr.arguments, ctx) : [expr];
    }
    return [expr];
  }
  if (ts.isFunctionLike(expr)) return [];
  return ts.isExpression(expr) ? [expr] : [];
}

/** 식이 만들 수 있는 객체 리터럴 후보. 문맥을 안 주면 가장 가까운 헬퍼 바인딩(있으면)을 잇는다. */
function resolveObjects(
  expr: ts.Node | undefined,
  ctx: ResolveCtx = ctxOf(expr),
): ts.ObjectLiteralExpression[] {
  return constituents(expr, ctx).filter(ts.isObjectLiteralExpression);
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
        if (!innerName) continue;
        if (RELINK_KEYS.has(innerName)) {
          if (!schema.relationMeta[model]?.[name]?.fkOwner)
            out.push({
              model: target,
              method: `nested ${innerName}`,
              line: lineOf(inner),
              nested: true,
            });
          continue;
        }
        if (!NESTED_WRITE_KEYS.has(innerName)) continue;
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
  kind: 'nested' | 'filter' | 'raw' | 'opaque' | 'root';
  /** nested/filter: `Root.path->Target`, raw: `method:table,table`, opaque: `method:Root.path=식`, root: `method:Model.호출` */
  key: string;
}

/** 다른 서비스 모델을 루트로 읽는 호출 — 포트/스냅샷으로 옮길 대상(write는 model-ownership.spec이 본다). */
const ROOT_READ_METHODS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

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

/** `_count: true`는 모든 list relation, `_count: { select: {...} }`는 고른 relation(과 그 쿼리 객체)만 센다. */
function countedRelations(
  count: ts.ObjectLiteralElementLike,
  model: string,
  schema: SchemaInfo,
): Array<[rel: string, query: ts.ObjectLiteralElementLike | null]> {
  const init = ts.isPropertyAssignment(count) ? count.initializer : undefined;
  if (init?.kind === ts.SyntaxKind.TrueKeyword)
    return Object.entries(schema.relationMeta[model] ?? {})
      .filter(([, meta]) => meta.list)
      .map(([rel]) => [rel, null]);
  return objectValues(count)
    .flatMap((countObj) =>
      propertiesOf(countObj).filter((p) => propName(p) === 'select'),
    )
    .flatMap((sel) => objectValues(sel))
    .flatMap((selObj) => propertiesOf(selObj))
    .flatMap((p) => {
      const rel = propName(p);
      return rel ? [[rel, p] as [string, ts.ObjectLiteralElementLike]] : [];
    });
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
            for (const [cRel, query] of countedRelations(
              inner,
              model,
              schema,
            )) {
              const cTarget = schema.relations[model]?.[cRel];
              if (!cTarget) continue;
              const countPath = `${path}._count.${cRel}`;
              if (serviceOfModel(cTarget) !== rootService)
                out.add(`nested:${countPath}->${cTarget}`);
              // `_count: { select: { items: { where: {...} } } }` — 필터된 카운트의 where도 대상 모델로 본다
              for (const q of query ? objectValues(query) : [])
                collectCrossReads(
                  q,
                  cTarget,
                  rootService,
                  countPath,
                  schema,
                  out,
                );
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
 * 구조 키(where/include/select/data/...)·relation 키 자리와 spread에 놓인 식의 잎이 객체 리터럴로 풀리지 않으면 opaque로 기록한다.
 * 파라미터 pass-through(`data: args.data`, `args.where ?? 기본값`의 왼쪽)처럼 검사기가 볼 수 없는 자리를 허용 목록으로 고정해, 새 불투명 자리가 생기면 실패하게 한다.
 */
function collectOpaque(
  expr: ts.Expression,
  model: string,
  path: string,
  schema: SchemaInfo,
  out: Set<string>,
  method: string,
): void {
  for (const leaf of constituents(expr, ctxOf(expr))) {
    if (!ts.isObjectLiteralExpression(leaf)) {
      if (isScalarLike(leaf)) continue;
      const text = leaf
        .getText(leaf.getSourceFile())
        .replace(/\s+/g, ' ')
        .slice(0, 60);
      out.add(`opaque:${method}:${path}=${text}`);
      continue;
    }
    for (const prop of leaf.properties) {
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
        if (
          fileService !== undefined &&
          rootService !== fileService &&
          ROOT_READ_METHODS.has(found.method)
        ) {
          keys.add(`root:${method}:${found.model}.${found.method}`);
        }
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
