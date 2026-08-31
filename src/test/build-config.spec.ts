import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import * as ts from 'typescript';

// 빌드 툴체인 설정(tsconfig.build.json × nest-cli.json)의 불변식을 고정한다.
// 이 조합은 다른 게이트가 전부 비껴간다 — tsc --noEmit은 tsconfig.json을 읽고,
// jest는 ts-jest로 자체 변환하며, CI 빌드는 clean 체크아웃 1회라 증분 캐시
// 오염을 재현하지 못한다. 그래서 설정 자체를 단언 대상으로 삼는다.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUILD_TSCONFIG = path.join(REPO_ROOT, 'tsconfig.build.json');
const NEST_CLI = path.join(REPO_ROOT, 'nest-cli.json');

type NestCliJson = { compilerOptions?: { deleteOutDir?: boolean } };

function parseBuildTsconfig(): ts.ParsedCommandLine {
  const read = ts.readConfigFile(BUILD_TSCONFIG, ts.sys.readFile);
  expect(read.error).toBeUndefined();

  return ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    REPO_ROOT,
    undefined,
    BUILD_TSCONFIG,
  );
}

describe('빌드 설정 불변식 (tsconfig.build.json × nest-cli.json)', () => {
  it('deleteOutDir·incremental 동시 활성 시 tsbuildinfo는 outDir 안에 생성된다', () => {
    const nestCli = JSON.parse(readFileSync(NEST_CLI, 'utf8')) as NestCliJson;
    const { options } = parseBuildTsconfig();

    // 아래 단언의 전제. 셋 중 하나라도 꺼지면 이 불변식 자체가 무의미해지므로
    // 조용히 통과시키지 않고 전제가 깨진 사실을 드러낸다.
    expect(nestCli.compilerOptions?.deleteOutDir).toBe(true);
    expect(options.incremental).toBe(true);
    expect(options.outDir).toBeDefined();

    const buildInfo = ts.getTsBuildInfoEmitOutputFilePath(options);
    expect(buildInfo).toBeDefined();

    // 왜: buildinfo가 outDir 밖이면 deleteOutDir이 dist만 지우고 캐시는 살아남는다.
    // tsc가 그 캐시를 보고 "전부 최신"으로 오판해 emit을 통째로 건너뛰고,
    // dist/main.js가 없는 채 "Found 0 errors"만 출력된다 → 실행 시 MODULE_NOT_FOUND.
    // rootDir 지정만으로 buildinfo가 루트로 밀려났던 회귀 이력이 있다(PR #60).
    const relativeToOutDir = path.relative(
      String(options.outDir),
      String(buildInfo),
    );
    expect(relativeToOutDir.startsWith('..')).toBe(false);
  });

  it('src/main.ts는 dist/main.js로 출력된다', () => {
    const parsed = parseBuildTsconfig();
    const [jsOutput] = ts.getOutputFileNames(
      parsed,
      path.join(REPO_ROOT, 'src', 'main.ts'),
      false,
    );

    // 왜: ecosystem.config.js(script: dist/main.js)와 start:prod(node dist/main)가
    // 이 경로에 묶여 있다. rootDir/include가 흔들리면 공통 루트가 프로젝트 루트로
    // 올라가 dist/src/main.js로 밀리고 PM2 부팅이 깨진다(회귀 이력: c43b5ba).
    expect(path.relative(REPO_ROOT, jsOutput)).toBe(
      path.join('dist', 'main.js'),
    );
  });
});
