// 감사 기록 경로 검사기의 입력 공간을 코드에서 읽어 온다.
// 두 가지만 본다 — ① auditLog 델리게이트 write는 라이브러리 1곳에만 있다 ② 감사 기록은 항상 트랜잭션 클라이언트로 부른다.
// 검사는 AST로 한다. 문자열 검색은 주석·문자열 리터럴을 구분하지 못해 반증 케이스가 통과해 버린다.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import * as ts from 'typescript';

const REPO_ROOT = join(__dirname, '..', '..');
const SRC_DIR = join(REPO_ROOT, 'src');

/** 감사 테이블에 직접 쓸 수 있는 유일한 파일. 늘리지 않는다 — 늘리면 트랜잭션 강제가 뚫린다. */
export const AUDIT_LIBRARY =
  'src/features/audit-log/repositories/audit-log.repository.ts';

/** 스캔 제외 — 생성물, 테스트 하네스, spec(픽스처는 직접 insert해도 된다). */
const SKIP_DIRS = new Set(['generated', 'test']);

const WRITE_METHODS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/** 트랜잭션 클라이언트로 인정하는 인자 이름. `prisma`·`this.prisma`는 여기 걸리지 않는다. */
const TX_ARG = /^(tx|[a-z][A-Za-z0-9]*Tx)$/;

export interface AuditSource {
  file: string;
  text: string;
}

export interface AuditViolation {
  file: string;
  line: number;
  kind: 'direct-write' | 'untx-record';
  detail: string;
}

export interface RecordCall {
  file: string;
  line: number;
  firstArg: string;
}

export function listAuditSources(dir: string = SRC_DIR): AuditSource[] {
  const out: AuditSource[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...listAuditSources(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push({
        file: relative(REPO_ROOT, full),
        text: readFileSync(full, 'utf8'),
      });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function eachCall(
  source: AuditSource,
  visit: (call: ts.CallExpression, line: number) => void,
): void {
  const sf = ts.createSourceFile(
    source.file,
    source.text,
    ts.ScriptTarget.ES2022,
    true,
  );
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      visit(node, sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
}

/** `<무엇이든>.auditLog.<write>(` 호출. 수신자 이름(prisma·tx·db…)은 따지지 않는다. */
function directAuditWrite(call: ts.CallExpression): string | null {
  const target = call.expression;
  if (!ts.isPropertyAccessExpression(target)) return null;
  const method = target.name.text;
  if (!WRITE_METHODS.has(method)) return null;
  const delegate = target.expression;
  if (!ts.isPropertyAccessExpression(delegate)) return null;
  if (delegate.name.text !== 'auditLog') return null;
  return `auditLog.${method}`;
}

function recordAuditCall(call: ts.CallExpression): boolean {
  const target = call.expression;
  return ts.isPropertyAccessExpression(target)
    ? target.name.text === 'recordAudit'
    : ts.isIdentifier(target) && target.text === 'recordAudit';
}

/** 감사 포트 호출 전수 — "위반 0"이 대상 0건이 아니라는 증거로 쓴다. */
export function collectRecordCalls(sources: AuditSource[]): RecordCall[] {
  const calls: RecordCall[] = [];
  for (const source of sources) {
    eachCall(source, (call, line) => {
      if (!recordAuditCall(call)) return;
      const first = call.arguments[0];
      calls.push({
        file: source.file,
        line,
        firstArg: first ? first.getText().trim() : '',
      });
    });
  }
  return calls;
}

export function collectAuditViolations(
  sources: AuditSource[],
): AuditViolation[] {
  const violations: AuditViolation[] = [];
  for (const source of sources) {
    eachCall(source, (call, line) => {
      const write = directAuditWrite(call);
      if (write && source.file !== AUDIT_LIBRARY) {
        violations.push({
          file: source.file,
          line,
          kind: 'direct-write',
          detail: write,
        });
      }
      if (recordAuditCall(call) && source.file !== AUDIT_LIBRARY) {
        const first = call.arguments[0];
        const text = first ? first.getText().trim() : '(인자 없음)';
        // 선언(인터페이스·구현)이 아니라 호출만 본다 — 호출의 1번 인자가 tx여야 한다.
        if (!first || !ts.isIdentifier(first) || !TX_ARG.test(text)) {
          violations.push({
            file: source.file,
            line,
            kind: 'untx-record',
            detail: `recordAudit(${text}, …)`,
          });
        }
      }
    });
  }
  return violations;
}
