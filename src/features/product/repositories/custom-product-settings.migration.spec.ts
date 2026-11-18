import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import mysql, { type RowDataPacket } from 'mysql2/promise';

import type { PrismaClient } from '@/generated/prisma/client';
import {
  disconnectTestPrismaClient,
  getTestDatabaseUrl,
} from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, nextSeq } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 커스텀 설정 마이그레이션의 백필 SQL을 그대로 실행해 기존 템플릿·문구 자리가 새 규칙으로 옮겨지는지 본다.
// 백필이 읽는 템플릿 is_active는 같은 마이그레이션에서 지워지고 좌표 NULL 행은 최신 스키마에서 만들 수 없어,
// 백필 직전 모양의 임시 표로 같은 이름을 가린 연결 하나에서 돌린다(임시 표는 세션 범위라 풀 연결로는 안 보인다).
const SQL = readFileSync(
  join(
    __dirname,
    '../../../../prisma/migrations/20261118155816_custom_product_settings/migration.sql',
  ),
  'utf8',
);

function statements(body: string): string[] {
  return body
    .split(';')
    .map((stmt) => stmt.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter((stmt) => stmt.length > 0);
}

const BACKFILL = statements(
  SQL.slice(SQL.indexOf('-- backfill'), SQL.indexOf('-- end backfill')),
);
/** 백필 바로 뒤 NOT NULL 전환. 백필이 남긴 NULL이 있으면 여기서 실패한다. */
const NOT_NULL_AFTER_BACKFILL = statements(
  SQL.slice(SQL.indexOf('-- end backfill')),
)[0];

const LEGACY_SHAPES: Array<[table: string, alter: string]> = [
  [
    'product_custom_template',
    'ADD COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT 1',
  ],
  [
    'product_custom_text_token',
    'MODIFY `label` VARCHAR(30) NULL, MODIFY `pos_x` INT NULL, MODIFY `pos_y` INT NULL, MODIFY `width` INT NULL, MODIFY `height` INT NULL',
  ],
];

describe('상품 커스텀 설정 백필 (real DB)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = await createTestingModuleWithRealDb({ providers: [] }));
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function withLegacyTables(
    run: (conn: mysql.Connection) => Promise<void>,
  ): Promise<void> {
    const conn = await mysql.createConnection({ uri: getTestDatabaseUrl() });
    try {
      for (const [table, alter] of LEGACY_SHAPES) {
        // 같은 이름을 LIKE로 바로 만들 수 없어 사본을 거친다
        await conn.query(
          `CREATE TEMPORARY TABLE \`_legacy_${table}\` LIKE \`${table}\``,
        );
        await conn.query(
          `CREATE TEMPORARY TABLE \`${table}\` LIKE \`_legacy_${table}\``,
        );
        // 가림이 안 된 채 ALTER가 진짜 표에 닿지 않게 먼저 확인한다
        const [[shown]] = await conn.query<RowDataPacket[]>(
          `SHOW CREATE TABLE \`${table}\``,
        );
        expect(String(shown['Create Table'])).toMatch(
          /^CREATE TEMPORARY TABLE/,
        );
        await conn.query(`ALTER TABLE \`${table}\` ${alter}`);
      }
      await run(conn);
    } finally {
      await conn.end();
    }
  }

  async function runBackfill(conn: mysql.Connection): Promise<void> {
    expect(BACKFILL).toHaveLength(8);
    for (const stmt of BACKFILL) await conn.query(stmt);
  }

  async function insertTemplate(
    conn: mysql.Connection,
    productId: bigint,
    isActive: boolean,
    deleted = false,
  ): Promise<number> {
    const [result] = await conn.query<mysql.ResultSetHeader>(
      'INSERT INTO product_custom_template (product_id, base_image_url, is_active, deleted_at, updated_at) VALUES (?, ?, ?, ?, NOW(3))',
      [
        productId,
        'https://i.example/base.png',
        isActive,
        deleted ? new Date() : null,
      ],
    );
    return result.insertId;
  }

  async function insertToken(
    conn: mysql.Connection,
    row: {
      templateId: number;
      key?: string;
      defaultText?: string;
      maxLength?: number;
      sortOrder?: number;
      area?: [number | null, number | null, number | null, number | null];
      deleted?: boolean;
    },
  ): Promise<number> {
    const [x, y, w, h] = row.area ?? [null, null, null, null];
    const [result] = await conn.query<mysql.ResultSetHeader>(
      'INSERT INTO product_custom_text_token (template_id, token_key, default_text, max_length, sort_order, pos_x, pos_y, width, height, deleted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))',
      [
        row.templateId,
        row.key ?? `k${nextSeq()}`,
        row.defaultText ?? '문구',
        row.maxLength ?? 30,
        row.sortOrder ?? 0,
        x,
        y,
        w,
        h,
        row.deleted ? new Date() : null,
      ],
    );
    return result.insertId;
  }

  async function tokens(conn: mysql.Connection): Promise<RowDataPacket[]> {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT id, label, default_text, max_length, pos_x, pos_y, width, height FROM product_custom_text_token ORDER BY id',
    );
    return rows;
  }

  it('활성·미삭제 템플릿이 있는 상품만 슬롯형이 된다', async () => {
    const [active, inactive, deleted, bare] = await Promise.all(
      [0, 1, 2, 3].map(() => createProduct(prisma)),
    );

    await withLegacyTables(async (conn) => {
      await insertTemplate(conn, active.id, true);
      await insertTemplate(conn, inactive.id, false);
      await insertTemplate(conn, deleted.id, true, true);
      await runBackfill(conn);
    });

    const modes = await prisma.product.findMany({
      where: { id: { in: [active.id, inactive.id, deleted.id, bare.id] } },
      select: { id: true, custom_mode: true },
    });
    expect(
      Object.fromEntries(modes.map((p) => [p.id.toString(), p.custom_mode])),
    ).toEqual({
      [active.id.toString()]: 'SLOT',
      [inactive.id.toString()]: 'NONE',
      [deleted.id.toString()]: 'NONE',
      [bare.id.toString()]: 'NONE',
    });
  });

  it('표시 이름은 키 앞 30자, 기본 문구는 50자에서 자르고, 최대 글자 수는 기본 문구 길이 이상·50 이하다', async () => {
    const product = await createProduct(prisma);

    await withLegacyTables(async (conn) => {
      const tpl = await insertTemplate(conn, product.id, true);
      const area: [number, number, number, number] = [0, 0, 100, 100];
      const cases: Array<[string, string, number]> = [
        ['a'.repeat(40), '가'.repeat(60), 30],
        ['short', 'abc', 2],
        ['big', 'abc', 99],
        ['emoji', '🎂🎂🎂', 1],
        ['zero', 'abc', 0],
      ];
      for (const [key, defaultText, maxLength] of cases) {
        await insertToken(conn, {
          templateId: tpl,
          key,
          defaultText,
          maxLength,
          area,
        });
      }

      await runBackfill(conn);

      expect(
        (await tokens(conn)).map((t) => [
          t.label,
          t.default_text,
          t.max_length,
        ]),
      ).toEqual([
        ['a'.repeat(30), '가'.repeat(50), 50],
        ['short', 'abc', 3],
        ['big', 'abc', 50],
        ['emoji', '🎂🎂🎂', 3],
        ['zero', 'abc', 3],
      ]);
      await conn.query(NOT_NULL_AFTER_BACKFILL);
    });
  });

  it('좌표가 하나라도 없는 자리는 판매자 앱 기본 배치(템플릿별 활성 순번)로, 있는 자리는 0~10000으로 자른다', async () => {
    const [p1, p2] = await Promise.all([
      createProduct(prisma),
      createProduct(prisma),
    ]);

    await withLegacyTables(async (conn) => {
      const tpl = await insertTemplate(conn, p1.id, true);
      const other = await insertTemplate(conn, p2.id, true);
      // 삭제 자리는 활성 자리 뒤 순번을 받는다(sort_order가 앞서도)
      const deleted = await insertToken(conn, {
        templateId: tpl,
        sortOrder: 0,
        deleted: true,
      });
      const first = await insertToken(conn, { templateId: tpl, sortOrder: 0 });
      const clamped = await insertToken(conn, {
        templateId: tpl,
        sortOrder: 1,
        area: [-5, 20000, 300, 12000],
      });
      const partial = await insertToken(conn, {
        templateId: tpl,
        sortOrder: 2,
        area: [10, 20, null, 40],
      });
      const fourth = await insertToken(conn, { templateId: tpl, sortOrder: 5 });
      const otherFirst = await insertToken(conn, {
        templateId: other,
        sortOrder: 9,
      });

      await runBackfill(conn);

      const byId = new Map(
        (await tokens(conn)).map((t) => [
          Number(t.id),
          [t.pos_x, t.pos_y, t.width, t.height],
        ]),
      );
      expect(byId.get(first)).toEqual([1000, 1000, 8000, 1500]);
      expect(byId.get(clamped)).toEqual([0, 10000, 300, 10000]);
      expect(byId.get(partial)).toEqual([1000, 5000, 8000, 1500]);
      expect(byId.get(fourth)).toEqual([1000, 7000, 8000, 1500]);
      expect(byId.get(deleted)).toEqual([1000, 8500, 8000, 1500]);
      expect(byId.get(otherFirst)).toEqual([1000, 1000, 8000, 1500]);
      await conn.query(NOT_NULL_AFTER_BACKFILL);
    });
  });

  it('백필 없이는 NOT NULL 전환이 실패한다(검증 반증)', async () => {
    const product = await createProduct(prisma);
    await withLegacyTables(async (conn) => {
      const tpl = await insertTemplate(conn, product.id, true);
      await insertToken(conn, { templateId: tpl });
      expect(NOT_NULL_AFTER_BACKFILL).toMatch(
        /^ALTER TABLE `product_custom_text_token` MODIFY `label`/,
      );
      await expect(conn.query(NOT_NULL_AFTER_BACKFILL)).rejects.toThrow();
    });
  });
});
