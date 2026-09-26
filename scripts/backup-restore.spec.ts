import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 복구 리허설: 실제 mysqldump로 덤프한 파일을 다른 DB로 복구해 같은 데이터·루틴이 나오는지.
// mysql:8.0 컨테이너 하나를 DB로, 같은 이미지로 backup.sh를 돌린다(운영 backup 이미지의 베이스). S3는 쓰지 않는다(단위 spec이 담당).
const SCRIPT = join(__dirname, '..', 'infra', 'backup', 'backup.sh');
const ID = `caquick-bkp-${process.pid}-${Date.now().toString(36)}`;
const NET = `${ID}-net`;
const DB = `${ID}-db`;

jest.setTimeout(240_000);

function docker(args: string[]): string {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function sql(database: string, query: string, user = 'root'): string {
  return docker([
    'exec',
    DB,
    'mysql',
    `-u${user}`,
    `-p${user === 'root' ? 'root' : 'caquick'}`,
    '-h127.0.0.1',
    '-N',
    '-e',
    query,
    database,
  ]).trim();
}

describe('infra/backup/backup.sh — 실제 mysqldump 덤프 → 복구 (docker)', () => {
  const out = mkdtempSync(join(tmpdir(), 'caquick-backup-restore-'));

  beforeAll(async () => {
    docker(['network', 'create', NET]);
    docker([
      'run',
      '-d',
      '--name',
      DB,
      '--network',
      NET,
      '-e',
      'MYSQL_ROOT_PASSWORD=root',
      '-e',
      'MYSQL_DATABASE=CaQuick',
      '-e',
      'MYSQL_USER=caquick',
      '-e',
      'MYSQL_PASSWORD=caquick',
      '-v',
      `${out}:/backup`,
      'mysql:8.0',
      '--default-authentication-plugin=mysql_native_password',
    ]);
    // 초기화 중 임시 서버(port 0)에 붙지 않게 TCP 3306이 열린 뒤를 기다린다
    const deadline = Date.now() + 180_000;
    for (;;) {
      try {
        docker([
          'exec',
          DB,
          'mysqladmin',
          'ping',
          '-uroot',
          '-proot',
          '-h127.0.0.1',
          '--silent',
        ]);
        sql('CaQuick', 'SELECT 1');
        break;
      } catch {
        if (Date.now() > deadline)
          throw new Error('mysql 컨테이너가 뜨지 않는다');
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
    sql(
      'CaQuick',
      "CREATE TABLE t (id INT PRIMARY KEY, v VARCHAR(50)); INSERT INTO t VALUES (1,'a'),(2,'가나다'),(3,'c\\'d')",
    );
    // 루틴은 운영처럼 앱 사용자(DEFINER=caquick)가 만든 것 — mysqldump --routines 권한 경로를 그대로 탄다
    sql('CaQuick', 'CREATE PROCEDURE p() SELECT COUNT(*) FROM t', 'caquick');
  });

  afterAll(() => {
    try {
      docker(['rm', '-f', DB]);
    } catch {
      /* 이미 없음 */
    }
    try {
      docker(['network', 'rm', NET]);
    } catch {
      /* 이미 없음 */
    }
  });

  it('앱 사용자 자격으로 덤프한 gz를 새 DB에 복구하면 행·루틴이 같다', () => {
    const stdout = docker([
      'run',
      '--rm',
      '--network',
      NET,
      '-v',
      `${SCRIPT}:/backup.sh:ro`,
      '-v',
      `${out}:/backup`,
      '-e',
      'BACKUP_RUN_ONCE=1',
      '-e',
      `MYSQL_HOST=${DB}`,
      '-e',
      'MYSQL_USER=caquick',
      '-e',
      'MYSQL_PASSWORD=caquick',
      '-e',
      'MYSQL_DATABASE=CaQuick',
      '--entrypoint',
      'bash',
      'mysql:8.0',
      '/backup.sh',
    ]);
    expect(stdout).toContain('로컬 파일만');
    const files = readdirSync(out).filter((f) => f.endsWith('.sql.gz'));
    expect(files).toHaveLength(1);

    docker([
      'exec',
      DB,
      'bash',
      '-c',
      `mysql -uroot -proot -h127.0.0.1 -e 'CREATE DATABASE restored' && gunzip < /backup/${files[0]} | mysql -uroot -proot -h127.0.0.1 restored`,
    ]);

    const rows = (db: string) => sql(db, 'SELECT id, v FROM t ORDER BY id');
    expect(rows('restored')).toBe(rows('CaQuick'));
    expect(rows('restored').split('\n')).toHaveLength(3);
    expect(
      sql(
        'restored',
        "SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='restored' AND ROUTINE_NAME='p'",
      ),
    ).toBe('1');
  });
});
