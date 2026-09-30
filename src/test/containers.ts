import { GenericContainer, Wait } from 'testcontainers';

/**
 * 테스트 컨테이너는 운영 컨테이너와 같은 Docker VM(4CPU·8GB)을 나눠 쓴다 — 상한이 없으면 전체 테스트가 운영을 굶긴다.
 * CI 러너(공개 저장소 ubuntu-latest, 4vCPU·16GB)에서도 호스트 CPU 수를 넘지 않아 같은 값으로 뜬다.
 * tmpfs 페이지는 컨테이너 메모리 cgroup에 합산되므로 MySQL 상한은 datadir 최대치를 포함한다.
 */
export const MYSQL_QUOTA = { cpu: 2, memory: 1.5 };
export const REDIS_QUOTA = { cpu: 1, memory: 0.25 };
// RabbitMQ 메모리 경보선(기본 상한의 60%)이 유휴 사용량보다 충분히 높아야 발행이 막히지 않는다.
export const RABBITMQ_QUOTA = { cpu: 1, memory: 1 };
export const MYSQL_DATADIR = '/var/lib/mysql';
export const MYSQL_DATADIR_TMPFS = 'rw,size=768m';

/** 매 실행 새로 만들고 버리는 DB라 내구성(fsync·doublewrite·binlog)과 계측이 필요 없다. SHOW VARIABLES 기대값. */
export const MYSQL_TEST_VARIABLES: Record<string, string> = {
  innodb_flush_log_at_trx_commit: '0',
  innodb_doublewrite: 'OFF',
  log_bin: 'OFF',
  performance_schema: 'OFF',
};

export const REDIS_TEST_CONFIG: Record<string, string> = {
  save: '',
  appendonly: 'no',
};

export function mysqlTestContainer(): GenericContainer {
  return new GenericContainer('mysql:8.0')
    .withExposedPorts(3306)
    .withEnvironment({
      MYSQL_ROOT_PASSWORD: 'test',
      MYSQL_DATABASE: 'caquick_test_root',
    })
    .withCommand([
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
      '--innodb-flush-log-at-trx-commit=0',
      '--innodb-doublewrite=OFF',
      // --log-bin=OFF는 끄는 게 아니라 'OFF'라는 이름으로 binlog를 켠다
      '--skip-log-bin',
      '--performance-schema=OFF',
    ])
    .withTmpFs({ [MYSQL_DATADIR]: MYSQL_DATADIR_TMPFS })
    .withResourcesQuota(MYSQL_QUOTA)
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: [
        'CMD-SHELL',
        'mysqladmin ping -h localhost -u root -ptest || exit 1',
      ],
      interval: 2_000_000_000, // 2s in nanoseconds
      timeout: 5_000_000_000,
      retries: 30,
      startPeriod: 10_000_000_000,
    })
    .withStartupTimeout(120_000);
}

export function redisTestContainer(): GenericContainer {
  return new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withCommand(['redis-server', '--save', '', '--appendonly', 'no'])
    .withResourcesQuota(REDIS_QUOTA)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .withStartupTimeout(60_000);
}

/** 기대 설정과 실제 값이 다른 항목. 옵션이 조용히 무시되거나 뒤바뀐 것을 잡는다. */
export function settingMismatches(
  expected: Record<string, string>,
  actual: Record<string, string | undefined>,
): string[] {
  // 기대가 비면 무엇도 검사하지 않고 통과하게 된다
  if (Object.keys(expected).length === 0) return ['기대 설정 없음'];
  return Object.entries(expected)
    .filter(([name, value]) => actual[name] !== value)
    .map(
      ([name, value]) =>
        `${name}: 기대 ${JSON.stringify(value)}, 실제 ${actual[name] === undefined ? '없음' : JSON.stringify(actual[name])}`,
    );
}
