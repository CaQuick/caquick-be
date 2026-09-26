import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 백업 스크립트의 실패 전파: mysqldump·S3 업로드 실패가 성공으로 기록되면 "어제 백업 있음"이 거짓이 된다.
// mysqldump·aws는 PATH의 가짜로 바꿔 돌린다 — 실DB 덤프·복구 리허설은 08의 spec.
const SCRIPT = join(__dirname, '..', 'infra', 'backup', 'backup.sh');

function fakeBin(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** 루프 모드를 N바퀴만 — 가짜 date(고정 시각)·가짜 sleep(N번째에 종료)으로 */
function runLoopOnce(
  hour: string,
  dateHour: string,
  opts: { loops?: number; s3Fails?: boolean; bucket?: string } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'caquick-backup-loop-'));
  const bin = join(root, 'bin');
  const out = join(root, 'out');
  mkdirSync(bin);
  fakeBin(bin, 'mysqldump', 'echo "-- MySQL dump"');
  fakeBin(
    bin,
    'aws',
    `echo "$*" >> "${join(root, 'aws.log')}"; ${opts.s3Fails ? 'exit 1' : 'exit 0'}`,
  );
  fakeBin(
    bin,
    'date',
    `case "$*" in *%H) echo ${dateHour};; *%F) echo 2026-09-25;; *%s) echo 1790000000;; *) echo 20260925T${dateHour}0000Z;; esac`,
  );
  // N바퀴 뒤 sleep에서 부모(루프)를 TERM으로 끝낸다 — 그냥 exit 0이면 루프가 공회전한다
  const counter = join(root, 'loops');
  fakeBin(
    bin,
    'sleep',
    `n=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${counter}"; [ "$n" -ge ${opts.loops ?? 1} ] && kill -s TERM $PPID; exit 0`,
  );
  try {
    execFileSync('bash', [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        BACKUP_DIR: out,
        BACKUP_HOUR: hour,
        BACKUP_S3_BUCKET: opts.bucket ?? '',
        ALIVE_FILE: join(root, 'alive'),
        MYSQL_USER: 'u',
        MYSQL_PASSWORD: 'p',
      },
    });
    return { ended: 'exit 0', files: readdirSync(out), uploads: uploads(root) };
  } catch (error) {
    const e = error as {
      status: number | null;
      signal: string | null;
      stderr: string;
    };
    return {
      ended: e.signal === 'SIGTERM' ? 'loop' : `exit ${e.status ?? e.signal}`,
      stderr: e.stderr,
      files: existsSync(out) ? readdirSync(out) : [],
      uploads: uploads(root),
    };
  }
}

function uploads(root: string): string[] {
  const p = join(root, 'aws.log');
  return existsSync(p)
    ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    : [];
}

function runOnce(opts: {
  dumpFails?: boolean;
  s3Fails?: boolean;
  bucket?: string;
  webhook?: string;
}) {
  const root = mkdtempSync(join(tmpdir(), 'caquick-backup-'));
  const bin = join(root, 'bin');
  const out = join(root, 'out');
  mkdirSync(bin);
  fakeBin(
    bin,
    'mysqldump',
    opts.dumpFails
      ? 'echo "-- partial"; echo "mysqldump: Got error" >&2; exit 2'
      : 'echo "-- MySQL dump"; echo "CREATE TABLE t (id int);"',
  );
  fakeBin(
    bin,
    'aws',
    opts.s3Fails ? 'echo "upload failed" >&2; exit 1' : 'exit 0',
  );
  // 경보 전송 기록 — 마지막 인자(URL)와 -d 본문
  fakeBin(bin, 'curl', `printf '%s\\n' "$@" >> "${join(root, 'curl.log')}"`);
  try {
    const stdout = execFileSync('bash', [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        BACKUP_RUN_ONCE: '1',
        BACKUP_DIR: out,
        BACKUP_S3_BUCKET: opts.bucket ?? '',
        DISCORD_ALERT_WEBHOOK_URL: opts.webhook ?? '',
        MYSQL_USER: 'u',
        MYSQL_PASSWORD: 'p',
      },
    });
    return { status: 0, stdout, files: readdirSync(out), curl: curlLog(root) };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return {
      status: e.status,
      stdout: e.stdout,
      stderr: e.stderr,
      files: readdirSync(out),
      curl: curlLog(root),
    };
  }
}

function curlLog(root: string): string {
  const p = join(root, 'curl.log');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

describe('infra/backup/backup.sh (BACKUP_RUN_ONCE)', () => {
  it('덤프 성공 → gz 파일 1개, 버킷 없으면 로컬만, 종료 0', () => {
    const r = runOnce({});
    expect(r.status).toBe(0);
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toMatch(/^CaQuick-\d{8}T\d{6}Z\.sql\.gz$/);
    expect(r.stdout).toContain('로컬 파일만');
  });

  it('반증: mysqldump가 실패하면 부분 파일을 지우고 0이 아닌 종료 — 성공한 백업으로 기록되지 않는다', () => {
    const r = runOnce({ dumpFails: true });
    expect(r.status).not.toBe(0);
    expect(r.files).toEqual([]);
    expect(r.stderr).toContain('mysqldump 실패');
  });

  it('반증: S3 업로드가 실패하면 로컬 파일은 남기고 0이 아닌 종료', () => {
    const r = runOnce({ s3Fails: true, bucket: 'b' });
    expect(r.status).not.toBe(0);
    expect(r.files).toHaveLength(1);
    expect(r.stderr).toContain('S3 업로드 실패');
  });

  it.each([
    ['4', '04'],
    ['04', '04'],
    ['19', '19'],
  ])(
    '반증: BACKUP_HOUR=%s 는 date +%%H=%s 와 맞는다 — 한 자리 시각도 백업이 돈다',
    (hour, dateHour) => {
      const r = runLoopOnce(hour, dateHour);
      expect(r.ended).toBe('loop');
      expect(r.files).toHaveLength(1);
    },
  );

  it('반증: 시각이 아니면(24·abc) 시작하지 않고 죽는다 — 조용히 백업 없는 healthy가 되지 않게', () => {
    for (const hour of ['24', 'abc', '4x']) {
      const r = runLoopOnce(hour, '04');
      expect({ hour, ended: r.ended }).toEqual({ hour, ended: 'exit 1' });
      expect(r.files).toEqual([]);
    }
  });

  it('반증: S3가 죽어 있으면 매분 재시도해도 새 덤프를 만들지 않고 같은 파일을 다시 올린다 — 하루에 덤프 60개로 디스크를 채우지 않는다', () => {
    const r = runLoopOnce('4', '04', { loops: 3, s3Fails: true, bucket: 'b' });
    expect(r.ended).toBe('loop');
    expect(r.files).toHaveLength(1);
    expect(r.uploads).toHaveLength(3);
    expect(new Set(r.uploads).size).toBe(1);
  });

  it('반증: MYSQL_USER·MYSQL_PASSWORD가 없으면 시작 시 죽는다', () => {
    expect(() =>
      execFileSync('bash', [SCRIPT], {
        stdio: 'pipe',
        env: { PATH: process.env.PATH ?? '', BACKUP_RUN_ONCE: '1' },
      }),
    ).toThrow();
  });

  it('반증: 실패하면 Discord 웹훅으로 경보를 보내고, 웹훅이 없으면 보내지 않는다 — 성공 때는 보내지 않는다', () => {
    const failed = runOnce({ dumpFails: true, webhook: 'https://hook.test/x' });
    expect(failed.status).not.toBe(0);
    expect(failed.curl).toContain('https://hook.test/x');
    expect(failed.curl).toContain('DB 백업 실패');
    expect(runOnce({ dumpFails: true }).curl).toBe('');
    expect(runOnce({ webhook: 'https://hook.test/x' }).curl).toBe('');
  });

  it('S3 업로드 성공 → uploaded 로그, 종료 0', () => {
    const r = runOnce({ bucket: 'b' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('uploaded s3://b/mysql/');
  });
});
