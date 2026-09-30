import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type Redis from 'ioredis';
import mysql from 'mysql2/promise';
import { getContainerRuntimeClient } from 'testcontainers';

import {
  MYSQL_DATADIR,
  MYSQL_DATADIR_TMPFS,
  MYSQL_QUOTA,
  MYSQL_TEST_VARIABLES,
  REDIS_QUOTA,
  REDIS_TEST_CONFIG,
  settingMismatches,
} from '@/test/containers';
import { connectTestRedis } from '@/test/db/redis-test-client';

const STATE_FILE = join(process.cwd(), '.tmp', 'test-db-state.json');

interface TestDbState {
  containerId: string;
  host: string;
  port: number;
  rootUser: string;
  rootPassword: string;
  redisContainerId: string;
}

async function hostConfigOf(containerId: string) {
  const client = await getContainerRuntimeClient();
  const info = await client.container.inspect(
    client.container.getById(containerId),
  );
  const { NanoCpus, Memory, Tmpfs } = info.HostConfig;
  return { NanoCpus, Memory, Tmpfs };
}

function quotaOf({ cpu, memory }: { cpu: number; memory: number }) {
  return { NanoCpus: cpu * 1e9, Memory: memory * 1024 ** 3 };
}

describe('settingMismatches', () => {
  it.each<[string, Record<string, string>, Record<string, string>, string[]]>([
    ['모두 일치', { a: '0', b: 'OFF' }, { a: '0', b: 'OFF' }, []],
    ['실제에만 있는 항목은 무시', { a: '0' }, { a: '0', z: '1' }, []],
    ['빈 문자열끼리 일치', { save: '' }, { save: '' }, []],
    ['값이 다름', { a: '0' }, { a: '1' }, ['a: 기대 "0", 실제 "1"']],
    [
      '대소문자 다름',
      { b: 'OFF' },
      { b: 'off' },
      ['b: 기대 "OFF", 실제 "off"'],
    ],
    ['실제에 없음', { a: '0' }, {}, ['a: 기대 "0", 실제 없음']],
    ['빈 문자열 기대인데 없음', { save: '' }, {}, ['save: 기대 "", 실제 없음']],
    ['공백 차이', { a: '0' }, { a: ' 0' }, ['a: 기대 "0", 실제 " 0"']],
    [
      '여러 건은 기대 순서대로',
      { a: '0', b: 'OFF', c: 'x' },
      { a: '2', b: 'OFF' },
      ['a: 기대 "0", 실제 "2"', 'c: 기대 "x", 실제 없음'],
    ],
    ['기대가 비면 검사 자체가 실패', {}, { a: '0' }, ['기대 설정 없음']],
  ])('%s', (_, expected, actual, mismatches) => {
    expect(settingMismatches(expected, actual)).toEqual(mismatches);
  });
});

describe('테스트 컨테이너 설정 (real DB)', () => {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as TestDbState;

  it('MySQL에 가속 설정이 실제로 적용돼 있고 datadir가 tmpfs 경로다', async () => {
    const expected = { ...MYSQL_TEST_VARIABLES, datadir: `${MYSQL_DATADIR}/` };
    const conn = await mysql.createConnection({
      host: state.host,
      port: state.port,
      user: state.rootUser,
      password: state.rootPassword,
    });
    try {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        'SHOW GLOBAL VARIABLES WHERE Variable_name IN (?)',
        [Object.keys(expected)],
      );
      const actual = Object.fromEntries(
        rows.map((r) => [r.Variable_name as string, r.Value as string]),
      );
      expect(settingMismatches(expected, actual)).toEqual([]);
    } finally {
      await conn.end();
    }
  });

  it('MySQL 컨테이너에 tmpfs datadir와 CPU·메모리 상한이 걸려 있다', async () => {
    expect(await hostConfigOf(state.containerId)).toEqual({
      ...quotaOf(MYSQL_QUOTA),
      Tmpfs: { [MYSQL_DATADIR]: MYSQL_DATADIR_TMPFS },
    });
  });

  it('Redis는 영속화가 꺼져 있고 CPU·메모리 상한이 걸려 있다', async () => {
    const redis: Redis = await connectTestRedis();
    try {
      const pairs = (await redis.call(
        'CONFIG',
        'GET',
        ...Object.keys(REDIS_TEST_CONFIG),
      )) as string[];
      const actual = Object.fromEntries(
        pairs.flatMap((v, i) => (i % 2 ? [] : [[v, pairs[i + 1]]])),
      );
      expect(settingMismatches(REDIS_TEST_CONFIG, actual)).toEqual([]);
    } finally {
      redis.disconnect();
    }
    expect(await hostConfigOf(state.redisContainerId)).toMatchObject(
      quotaOf(REDIS_QUOTA),
    );
  });
});
