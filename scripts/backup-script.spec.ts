import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 백업 스크립트의 실패 전파(P2-06 리뷰): mysqldump·S3 업로드 실패가 성공으로 기록되면 "어제 백업 있음"이 거짓이 된다.
// mysqldump·aws는 PATH의 가짜로 바꿔 돌린다 — 실DB 덤프·복구 리허설은 08의 spec.
const SCRIPT = join(__dirname, '..', 'infra', 'backup', 'backup.sh');

function fakeBin(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function runOnce(opts: {
  dumpFails?: boolean;
  s3Fails?: boolean;
  bucket?: string;
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
  try {
    const stdout = execFileSync('bash', [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        BACKUP_RUN_ONCE: '1',
        BACKUP_DIR: out,
        BACKUP_S3_BUCKET: opts.bucket ?? '',
        MYSQL_USER: 'u',
        MYSQL_PASSWORD: 'p',
      },
    });
    return { status: 0, stdout, files: readdirSync(out) };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return {
      status: e.status,
      stdout: e.stdout,
      stderr: e.stderr,
      files: readdirSync(out),
    };
  }
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

  it('S3 업로드 성공 → uploaded 로그, 종료 0', () => {
    const r = runOnce({ bucket: 'b' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('uploaded s3://b/mysql/');
  });
});
