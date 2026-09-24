import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import * as ts from 'typescript';

// main.ts는 커버리지 제외라 어떤 spec도 지나지 않는다 — 부팅 실패 경보가 걸린 배선을 AST로 고정한다.
// NestFactory.create의 기본(abortOnError=true)은 DI·config 단계 실패를 process.exit(1)로 끝내
// bootstrap().catch(부팅 경보·stderr 봉투)에 닿지 않는다(자체 리뷰에서 dist 실측으로 확인).
const MAIN = path.resolve(__dirname, '..', 'main.ts');

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(MAIN, source, ts.ScriptTarget.Latest, true);
}

/** 주석·문자열 속 텍스트가 아니라 실제 호출식만 — 텍스트 검색이면 주석 처리한 호출도 통과한다 */
function findCalls(root: ts.Node, callee: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText() === callee) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
}

function literalProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const prop = object.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) && p.name.getText() === name,
  );
  return prop?.initializer.getText();
}

/** 검사 본체 — 실제 main.ts와 변형본에 같은 규칙을 적용한다 */
function checkBootstrap(source: string): string[] {
  const problems: string[] = [];
  const sf = parse(source);

  const creates = findCalls(sf, 'NestFactory.create');
  if (creates.length !== 1) {
    problems.push(`NestFactory.create ${creates.length}회`);
  }
  const options = creates[0]?.arguments[1];
  if (
    !options ||
    !ts.isObjectLiteralExpression(options) ||
    literalProperty(options, 'abortOnError') !== 'false'
  ) {
    problems.push('abortOnError:false 없음');
  }

  const [handler] = findCalls(sf, 'bootstrap().catch');
  if (!handler) {
    problems.push('bootstrap().catch 없음');
    return problems;
  }
  for (const callee of [
    'shouldSendBootAlert',
    'postDiscordAlert',
    'process.stderr.write',
  ]) {
    if (findCalls(handler, callee).length === 0) {
      problems.push(`${callee} 호출 없음`);
    }
  }
  const exits = findCalls(handler, 'process.exit');
  if (!exits.some((call) => call.arguments[0]?.getText() === '1')) {
    problems.push('process.exit(1) 호출 없음');
  }
  return problems;
}

describe('main.ts 부팅 배선', () => {
  const source = readFileSync(MAIN, 'utf8');

  it('NestFactory.create는 abortOnError:false, bootstrap().catch는 경보·stderr·exit 1을 실제로 호출한다', () => {
    expect(checkBootstrap(source)).toEqual([]);
  });

  // 반증 전수 — 게이트가 막아야 할 변형을 실제로 막는지
  it.each([
    [
      'abortOnError 삭제',
      (s: string) => s.replace(/\s*abortOnError: false,/, ''),
      'abortOnError:false 없음',
    ],
    [
      'abortOnError:true',
      (s: string) => s.replace('abortOnError: false', 'abortOnError: true'),
      'abortOnError:false 없음',
    ],
    [
      'process.exit(1)을 주석 처리',
      (s: string) => s.replace('process.exit(1);', '// process.exit(1);'),
      'process.exit(1) 호출 없음',
    ],
    [
      'process.exit(0)',
      (s: string) => s.replace('process.exit(1);', 'process.exit(0);'),
      'process.exit(1) 호출 없음',
    ],
    [
      '경보 전송 삭제',
      (s: string) => s.replace(/await postDiscordAlert\([\s\S]*?\);\n/, ''),
      'postDiscordAlert 호출 없음',
    ],
    [
      'catch 자체 삭제',
      (s: string) =>
        s.replace(/bootstrap\(\)\.catch\([\s\S]*$/, 'void bootstrap();\n'),
      'bootstrap().catch 없음',
    ],
  ])('반증: %s → 실패', (_, mutate, expected) => {
    const mutated = mutate(source);
    expect(mutated).not.toBe(source); // 변형이 실제로 적용됐는지 — 아니면 "막았다"가 무의미
    expect(checkBootstrap(mutated)).toContain(expected);
  });
});
