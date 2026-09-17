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

describe('Prisma 생성 클라이언트 경로 불변식', () => {
  const schema = readFileSync(
    path.join(REPO_ROOT, 'prisma', 'schema.prisma'),
    'utf8',
  );
  const output = /generator client \{[^}]*output\s*=\s*"([^"]+)"/.exec(
    schema,
  )?.[1];

  it('generator output은 tsconfig.build rootDir(src) 안이라 dist/generated로 함께 방출된다', () => {
    // 왜: 런타임 import가 @/generated/prisma/client에 묶여 있다. output이 src 밖으로
    // 나가면 tsc가 방출하지 않아 dist/main.js 부팅이 모듈 부재로 깨진다.
    expect(output).toBeDefined();
    const resolved = path.resolve(REPO_ROOT, 'prisma', output!);
    expect(path.relative(path.join(REPO_ROOT, 'src'), resolved)).toBe(
      path.join('generated', 'prisma'),
    );
  });

  it('생성물은 커밋되지 않고 postinstall이 만든다', () => {
    // 왜: 생성물(10만 줄)을 커밋하면 스키마와 어긋난 채 남을 수 있고, gitignore만 있고
    // postinstall이 빠지면 clone·CI에서 tsc부터 실패한다. 둘이 짝이다.
    const gitignore = readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore.split('\n')).toContain('src/generated/');
    const pkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts.postinstall).toBe('prisma generate');
  });
});

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

    // buildinfo가 outDir 밖이면 deleteOutDir이 dist만 지우고 캐시는 살아남는다. tsc가 그 캐시를 보고 "전부 최신"으로
    // 오판해 emit을 통째로 건너뛰고, dist/main.js가 없는 채 "Found 0 errors"만 출력된다 → 실행 시 MODULE_NOT_FOUND.
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

    // ecosystem.config.js(script: dist/main.js)와 start:prod(node dist/main)가 이 경로에 묶여 있다.
    // rootDir/include가 흔들리면 공통 루트가 프로젝트 루트로 올라가 dist/src/main.js로 밀리고 PM2 부팅이 깨진다.
    expect(path.relative(REPO_ROOT, jsOutput)).toBe(
      path.join('dist', 'main.js'),
    );
  });

  it('빌드 설정이 .js를 실제로 방출하도록 되어 있다', () => {
    const { options } = parseBuildTsconfig();

    // 왜: 위 두 단언은 "설정상 어디로 나가야 하는가"만 본다. noEmit이나
    // emitDeclarationOnly가 켜지면 getOutputFileNames는 이론상 경로를 그대로
    // 돌려주므로 단언은 통과하는데 nest build는 exit 0으로 아무것도(또는 .d.ts만)
    // 내보내지 않는다. 실측: noEmit → .js 0개, emitDeclarationOnly → .js 0개
    // /.d.ts 396개. 둘 다 dist/main.js 부재로 이어지므로 함께 막는다.
    expect(options.noEmit ?? false).toBe(false);
    expect(options.emitDeclarationOnly ?? false).toBe(false);
  });
});
