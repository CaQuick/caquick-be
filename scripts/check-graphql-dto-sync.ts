/**
 * SDL ↔ DTO 동기화 검사 스크립트.
 *
 * 왜: A-2 전략(모든 Input을 class + class-validator로 정의)에서 SDL과 DTO class가
 * 어긋나면 런타임 검증이 실제 스키마와 불일치하게 된다. 빌드 시점에 차단한다.
 *
 * 검사 항목:
 *  - SDL `input` 타입에 대응하는 DTO class가 존재하는지 (`--strict` 시)
 *  - 양쪽 모두 존재할 때 필드명과 필수여부가 일치하는지
 *
 * 모드:
 *  - default: DTO가 있는 항목만 검사. SDL only는 정보 출력
 *  - --strict: 모든 SDL input 에 DTO 필수
 *  - --warning: 종료코드 0 (CI 경고용)
 *
 * 사용: yarn dto:check [--strict] [--warning]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import type { InputObjectTypeDefinitionNode, TypeNode } from 'graphql';
import { Kind, parse } from 'graphql';
import { Project } from 'ts-morph';
import type { ClassDeclaration } from 'ts-morph';

interface FieldShape {
  name: string;
  required: boolean;
}

interface DtoEntry {
  fields: FieldShape[];
  file: string;
}

const REPO_ROOT = resolve(__dirname, '..');
const SDL_ROOTS = [join(REPO_ROOT, 'src')];
const DTO_FILE_SUFFIX = '.input.ts';
const SDL_FILE_EXT = '.graphql';
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.yarn']);

const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const WARNING_ONLY = args.has('--warning');

function walk(dir: string, predicate: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, predicate));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function unwrapType(typeNode: TypeNode): { required: boolean } {
  // GraphQL: 외곽 NON_NULL 이면 required. LIST 내부 NON_NULL 은 무시 (요소 nullability)
  return { required: typeNode.kind === Kind.NON_NULL_TYPE };
}

function loadSdlInputs(): Map<string, FieldShape[]> {
  const result = new Map<string, FieldShape[]>();
  const files: string[] = [];
  for (const root of SDL_ROOTS) {
    if (!safeStat(root)) continue;
    files.push(...walk(root, (p) => extname(p) === SDL_FILE_EXT));
  }

  for (const file of files) {
    const sdl = readFileSync(file, 'utf8');
    let doc;
    try {
      doc = parse(sdl);
    } catch {
      // SDL 파싱 실패는 다른 도구가 잡는다. 여기서는 무시.
      continue;
    }
    for (const def of doc.definitions) {
      if (def.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION) continue;
      const input = def;
      const fields: FieldShape[] = (input.fields ?? []).map((f) => ({
        name: f.name.value,
        required: unwrapType(f.type).required,
      }));
      result.set(input.name.value, fields);
    }
  }

  return result;
}

function collectClassFields(cls: ClassDeclaration): FieldShape[] {
  const out: FieldShape[] = [];
  const seen = new Set<string>();

  let current: ClassDeclaration | undefined = cls;
  while (current) {
    for (const prop of current.getProperties()) {
      const name = prop.getName();
      if (seen.has(name)) continue;
      seen.add(name);
      // 필수여부 추정: `?` 없으면 필수. `@IsOptional()` 은 별도 신호이지만 여기서는
      // TS 문법(`?`) 기준으로만 본다. (class-validator 데코레이터는 런타임 검증의
      // 영역이고, SDL 정합 기준은 TS 시그니처와 동등하다고 본다.)
      const required = !prop.hasQuestionToken();
      out.push({ name, required });
    }
    current = current.getBaseClass();
  }

  return out;
}

function loadDtoClasses(): Map<string, DtoEntry> {
  const result = new Map<string, DtoEntry>();
  const files: string[] = [];
  for (const root of SDL_ROOTS) {
    if (!safeStat(root)) continue;
    files.push(...walk(root, (p) => p.endsWith(DTO_FILE_SUFFIX)));
  }
  if (files.length === 0) return result;

  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(files);

  for (const sourceFile of project.getSourceFiles()) {
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (!name) continue;
      if (!name.endsWith('Input')) continue;
      result.set(name, {
        fields: collectClassFields(cls),
        file: sourceFile.getFilePath(),
      });
    }
  }

  return result;
}

interface Report {
  errors: string[];
  info: string[];
}

function compare(
  sdl: Map<string, FieldShape[]>,
  dto: Map<string, DtoEntry>,
): Report {
  const errors: string[] = [];
  const info: string[] = [];

  for (const [name, sdlFields] of sdl) {
    const dtoEntry = dto.get(name);
    if (!dtoEntry) {
      const msg = `SDL input "${name}" 에 대응하는 DTO class 가 없습니다.`;
      if (STRICT) errors.push(`[MISSING_DTO] ${msg}`);
      else info.push(`[INFO] ${msg}`);
      continue;
    }

    const sdlMap = new Map(sdlFields.map((f) => [f.name, f]));
    const dtoMap = new Map(dtoEntry.fields.map((f) => [f.name, f]));

    for (const f of sdlFields) {
      const dtoField = dtoMap.get(f.name);
      if (!dtoField) {
        errors.push(
          `[FIELD_MISSING] ${name}.${f.name}: SDL에는 있으나 DTO 에 없음. (${dtoEntry.file})`,
        );
        continue;
      }
      if (dtoField.required !== f.required) {
        errors.push(
          `[REQUIRED_MISMATCH] ${name}.${f.name}: SDL required=${String(f.required)}, DTO required=${String(dtoField.required)}. (${dtoEntry.file})`,
        );
      }
    }

    for (const f of dtoEntry.fields) {
      if (!sdlMap.has(f.name)) {
        errors.push(
          `[EXTRA_DTO_FIELD] ${name}.${f.name}: DTO 에 있으나 SDL 에 없음. (${dtoEntry.file})`,
        );
      }
    }
  }

  return { errors, info };
}

function safeStat(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function main(): void {
  const sdl = loadSdlInputs();
  const dto = loadDtoClasses();
  const { errors, info } = compare(sdl, dto);

  console.log(
    `[dto:check] SDL inputs=${sdl.size}, DTO classes=${dto.size}, mode=${STRICT ? 'strict' : 'lenient'}${WARNING_ONLY ? ' (warning)' : ''}`,
  );

  if (info.length > 0 && !STRICT) {
    console.log(`\nInfo (${info.length}):`);
    for (const line of info) {
      console.log(`  ${line}`);
    }
  }

  if (errors.length === 0) {
    console.log('\n✓ SDL ↔ DTO sync OK');
    process.exit(0);
  }

  console.error(`\nMismatches (${errors.length}):`);
  for (const line of errors) {
    console.error(`  ${line}`);
  }

  if (WARNING_ONLY) {
    console.warn(
      '\n[warning mode] CI 를 실패시키지 않습니다. 마이그레이션 완료 후 warning 플래그 제거 + --strict 로 승격하세요.',
    );
    process.exit(0);
  }

  process.exit(1);
}

main();
