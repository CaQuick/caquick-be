import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import mysql, { type RowDataPacket } from 'mysql2/promise';

import {
  disconnectTestPrismaClient,
  getTestDatabaseUrl,
} from '@/test/db/prisma-test-client';
import { closeTruncateConnection } from '@/test/db/truncate';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 주문 커스텀 스냅샷 마이그레이션의 열 추가·백필·기본값 제거를 그대로 실행해 기존 문구·자유 편집이 새 모양으로 옮겨지는지 본다.
// 지워지는 crop_image_url과 기본값 없는 NOT NULL 열 때문에 최신 스키마에서는 옛 행을 만들 수 없어,
// 마이그레이션 직전 모양의 임시 표로 같은 이름을 가린 연결 하나에서 돌린다(임시 표는 세션 범위라 풀 연결로는 안 보인다).
const MIGRATIONS = join(__dirname, '../../../../prisma/migrations');
const SQL = readFileSync(
  join(
    MIGRATIONS,
    readdirSync(MIGRATIONS).find((d) => d.endsWith('_order_custom_snapshot'))!,
    'migration.sql',
  ),
  'utf8',
);

const STATEMENTS = SQL.split(';')
  .map((stmt) => stmt.replace(/^\s*--[^\n]*$/gm, '').trim())
  .filter((stmt) => stmt.length > 0);
/** 기존 행에 닿는 문장(열 추가 → 백필 → 기본값 제거). 새 표 생성·FK는 빈 표라 제외한다. */
const DATA_STEPS = STATEMENTS.slice(
  0,
  STATEMENTS.findIndex((stmt) => stmt.startsWith('CREATE TABLE')),
);

const LEGACY_SHAPES: Array<[table: string, alter: string]> = [
  [
    'order_item',
    'DROP COLUMN `custom_mode_snapshot`, DROP COLUMN `custom_base_image_url_snapshot`, DROP COLUMN `custom_preview_image_url`',
  ],
  [
    'order_item_custom_text',
    'DROP COLUMN `token_id`, DROP COLUMN `label_snapshot`, DROP COLUMN `pos_x`, DROP COLUMN `pos_y`, DROP COLUMN `width`, DROP COLUMN `height`, DROP COLUMN `text_color`, DROP COLUMN `text_align`, MODIFY `value_text` VARCHAR(200) NOT NULL',
  ],
  [
    'order_item_custom_free_edit',
    'DROP COLUMN `pos_x`, DROP COLUMN `pos_y`, DROP COLUMN `width`, DROP COLUMN `height`, ADD COLUMN `crop_image_url` VARCHAR(2048) NOT NULL',
  ],
];

describe('주문 커스텀 스냅샷 마이그레이션 (real DB)', () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    await createTestingModuleWithRealDb({ providers: [] });
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  // 행은 전부 연결이 닫히면 사라지는 임시 표에만 쓴다
  beforeEach(async () => {
    conn = await mysql.createConnection({ uri: getTestDatabaseUrl() });
    for (const [table, alter] of LEGACY_SHAPES) {
      // 같은 이름을 LIKE로 바로 만들 수 없어 사본을 거친다
      await conn.query(
        `CREATE TEMPORARY TABLE \`_legacy_${table}\` LIKE \`${table}\``,
      );
      await conn.query(
        `CREATE TEMPORARY TABLE \`${table}\` LIKE \`_legacy_${table}\``,
      );
      // 가림이 안 된 채 ALTER가 진짜 표에 닿지 않게 먼저 확인한다
      expect(await showCreate(table)).toMatch(/^CREATE TEMPORARY TABLE/);
      await conn.query(`ALTER TABLE \`${table}\` ${alter}`);
    }
  });
  afterEach(async () => {
    await conn.end();
  });

  async function showCreate(table: string): Promise<string> {
    const [[row]] = await conn.query<RowDataPacket[]>(
      `SHOW CREATE TABLE \`${table}\``,
    );
    return String(row['Create Table']);
  }

  async function insert(
    table: string,
    row: Record<string, unknown>,
  ): Promise<number> {
    const columns = Object.keys(row);
    const [result] = await conn.query<mysql.ResultSetHeader>(
      `INSERT INTO \`${table}\` (${columns.join(', ')}, updated_at) VALUES (${columns.map(() => '?').join(', ')}, NOW(3))`,
      Object.values(row),
    );
    return result.insertId;
  }

  const insertItem = () =>
    insert('order_item', {
      order_id: 1,
      store_id: 1,
      product_id: 1,
      product_name_snapshot: '케이크',
      regular_price_snapshot: 10000,
      store_name_snapshot: '매장',
    });
  const insertText = (orderItemId: number, key: string, deleted = false) =>
    insert('order_item_custom_text', {
      order_item_id: orderItemId,
      token_key_snapshot: key,
      default_text_snapshot: '기본',
      value_text: '입력',
      deleted_at: deleted ? new Date() : null,
    });
  const insertFreeEdit = (orderItemId: number, deleted = false) =>
    insert('order_item_custom_free_edit', {
      order_item_id: orderItemId,
      crop_image_url: 'https://img/crop.png',
      description_text: '요청',
      deleted_at: deleted ? new Date() : null,
    });

  async function runMigration(): Promise<void> {
    expect(DATA_STEPS).toHaveLength(7);
    for (const stmt of DATA_STEPS) await conn.query(stmt);
  }

  it('문구는 키 앞 30자 표시 이름·바탕 전체 영역·검정·가운데로, 자유 편집은 바탕 전체 영역으로 옮기고 크롭을 지운다', async () => {
    const item = await insertItem();
    const keys = ['message', 'k'.repeat(40), '한'.repeat(40)];
    for (const key of keys) await insertText(item, key);
    await insertFreeEdit(item);

    await runMigration();

    const [texts] = await conn.query<RowDataPacket[]>(
      'SELECT label_snapshot, value_text, token_id, pos_x, pos_y, width, height, text_color, text_align FROM order_item_custom_text ORDER BY id',
    );
    expect(texts).toEqual(
      ['message', 'k'.repeat(30), '한'.repeat(30)].map((label) => ({
        label_snapshot: label,
        value_text: '입력',
        token_id: null,
        pos_x: 0,
        pos_y: 0,
        width: 10000,
        height: 10000,
        text_color: '#000000',
        text_align: 'CENTER',
      })),
    );
    const [edits] = await conn.query<RowDataPacket[]>(
      'SELECT pos_x, pos_y, width, height FROM order_item_custom_free_edit',
    );
    expect(edits).toEqual([
      { pos_x: 0, pos_y: 0, width: 10000, height: 10000 },
    ]);
  });

  it('기본값을 지워 새 행은 좌표·스타일을 모두 받아야 하고, 선택 자리를 지운 문구는 null로 둘 수 있다', async () => {
    await runMigration();

    const text = await showCreate('order_item_custom_text');
    for (const column of ['pos_x', 'pos_y', 'width', 'height']) {
      expect(text).toContain(`\`${column}\` int NOT NULL,`);
    }
    expect(text).toMatch(/`label_snapshot` varchar\(30\)[^,]* NOT NULL,/);
    expect(text).toMatch(/`text_color` char\(7\)[^,]* NOT NULL,/);
    expect(text).toMatch(/`text_align` enum\([^)]*\)[^,]* NOT NULL,/);
    expect(text).toMatch(/`value_text` varchar\(200\)[^,]* DEFAULT NULL,/);
    const edit = await showCreate('order_item_custom_free_edit');
    expect(edit).not.toContain('crop_image_url');
    for (const column of ['pos_x', 'pos_y', 'width', 'height']) {
      expect(edit).toContain(`\`${column}\` int NOT NULL,`);
    }
  });

  it('살아 있는 문구나 자유 편집이 있는 품목만 슬롯형이 된다', async () => {
    const withText = await insertItem();
    await insertText(withText, 'a');
    const withFreeEdit = await insertItem();
    await insertFreeEdit(withFreeEdit);
    const deletedOnly = await insertItem();
    await insertText(deletedOnly, 'b', true);
    await insertFreeEdit(deletedOnly, true);
    const bare = await insertItem();

    await runMigration();

    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT id, custom_mode_snapshot, custom_base_image_url_snapshot, custom_preview_image_url FROM order_item ORDER BY id',
    );
    expect(rows).toEqual(
      [
        [withText, 'SLOT'],
        [withFreeEdit, 'SLOT'],
        [deletedOnly, 'NONE'],
        [bare, 'NONE'],
      ].map(([id, mode]) => ({
        id,
        custom_mode_snapshot: mode,
        custom_base_image_url_snapshot: null,
        custom_preview_image_url: null,
      })),
    );
  });
});
