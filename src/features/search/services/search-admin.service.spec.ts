import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { SearchAdminRepository } from '@/features/search/repositories/search-admin.repository';
import { AdminSearchKeywordChipService } from '@/features/search/services/search-admin.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createSearchKeywordChip } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminSearchKeywordChipService (real DB)', () => {
  let service: AdminSearchKeywordChipService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminSearchKeywordChipService,
        SearchAdminRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminSearchKeywordChipService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  async function chipAudits(chipId: bigint) {
    return prisma.auditLog.findMany({
      where: { target_type: 'SEARCH_KEYWORD_CHIP', target_id: chipId },
      orderBy: { id: 'asc' },
    });
  }

  const T1 = new Date('2026-12-01T00:00:00.000Z');
  const T2 = new Date('2026-12-26T00:00:00.000Z');
  // 실행 날짜와 무관하게 노출 기간 밖인 시각
  const LONG_AGO = new Date('2020-01-01T00:00:00.000Z');
  const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z');

  describe('adminSearchKeywordChips', () => {
    it('삭제를 뺀 전체(비활성·기간 밖 포함)를 sortOrder·id 순으로 준다', async () => {
      const actor = await admin();
      await createSearchKeywordChip(prisma, { keyword: '둘', sort_order: 1 });
      await createSearchKeywordChip(prisma, {
        keyword: '셋',
        sort_order: 1,
        is_active: false,
      });
      await createSearchKeywordChip(prisma, {
        keyword: '하나',
        sort_order: 0,
        ends_at: LONG_AGO,
      });
      await createSearchKeywordChip(prisma, {
        keyword: '넷',
        sort_order: 2,
        starts_at: FAR_FUTURE,
      });
      await createSearchKeywordChip(prisma, {
        keyword: '삭제',
        deleted_at: T1,
      });

      const rows = await service.adminSearchKeywordChips(actor);

      expect(rows.map((r) => r.keyword)).toEqual(['하나', '둘', '셋', '넷']);
      expect(rows[0]).toMatchObject({
        sortOrder: 0,
        isActive: true,
        startsAt: null,
        endsAt: LONG_AGO,
      });
    });

    it('관리자가 아니면 ADMIN_ONLY', async () => {
      const user = await createAccount(prisma, { account_type: 'USER' });

      await expect(
        service.adminSearchKeywordChips(user.id),
      ).rejects.toThrowDomain('ADMIN_ONLY');
    });
  });

  describe('adminCreateSearchKeywordChip', () => {
    it('키워드를 검색 규칙으로 정규화해 맨 뒤에 만들고 감사를 남긴다', async () => {
      const actor = await admin();
      // 순서 값에 빈칸이 있어 "칩 수"와 "최대 + 1"이 다르다
      await createSearchKeywordChip(prisma, { sort_order: 0 });
      await createSearchKeywordChip(prisma, { sort_order: 5 });
      // 삭제된 칩의 순서는 맨 뒤 계산에서 뺀다
      await createSearchKeywordChip(prisma, { sort_order: 9, deleted_at: T1 });

      const chip = await service.adminCreateSearchKeywordChip(actor, {
        keyword: '  크리스마스   케이크 ',
        startsAt: T1,
      });

      expect(chip).toMatchObject({
        keyword: '크리스마스 케이크',
        sortOrder: 6,
        isActive: true,
        startsAt: T1,
        endsAt: null,
      });
      const row = await prisma.searchKeywordChip.findUniqueOrThrow({
        where: { id: BigInt(chip.id) },
      });
      expect(row.active_key).toBe('크리스마스 케이크');
      const [audit] = await chipAudits(row.id);
      expect(audit).toMatchObject({
        actor_account_id: actor,
        store_id: null,
        action: 'CREATE',
        after_json: {
          keyword: '크리스마스 케이크',
          sortOrder: 6,
          isActive: true,
          startsAt: T1.toISOString(),
          endsAt: null,
        },
      });
    });

    it('첫 칩은 0번, isActive를 명시하면 그 값으로 만든다', async () => {
      const actor = await admin();

      const chip = await service.adminCreateSearchKeywordChip(actor, {
        keyword: '신년',
        isActive: false,
      });

      expect(chip).toMatchObject({ sortOrder: 0, isActive: false });
    });

    it.each([
      ['빈 문자열', '', 'KEYWORD_EMPTY'],
      ['공백만', '   ', 'KEYWORD_EMPTY'],
      ['길이 초과', 'a'.repeat(201), 'KEYWORD_TOO_LONG'],
    ])('키워드 %s → %s', async (_label, keyword, code) => {
      const actor = await admin();

      await expect(
        service.adminCreateSearchKeywordChip(actor, { keyword }),
      ).rejects.toThrowDomain(code);
      expect(await prisma.searchKeywordChip.count()).toBe(0);
    });

    it.each([
      ['시작 = 종료', T1, T1, 'INVALID_EXPOSURE_WINDOW'],
      ['시작 > 종료', T2, T1, 'INVALID_EXPOSURE_WINDOW'],
      ['시작 < 종료', T1, T2, null],
      ['시작만', T1, null, null],
      ['종료만', null, T2, null],
    ])('노출 기간 %s', async (_label, startsAt, endsAt, code) => {
      const actor = await admin();
      const create = service.adminCreateSearchKeywordChip(actor, {
        keyword: '2026',
        startsAt,
        endsAt,
      });

      if (code) {
        await expect(create).rejects.toThrowDomain(code);
      } else {
        await expect(create).resolves.toMatchObject({ startsAt, endsAt });
      }
    });

    it('삭제되지 않은 칩과 키워드가 같으면(대소문자 무시) TAKEN, 삭제된 칩의 키워드는 다시 쓸 수 있다', async () => {
      const actor = await admin();
      await createSearchKeywordChip(prisma, { keyword: 'Cake' });
      await createSearchKeywordChip(prisma, {
        keyword: '신년',
        deleted_at: T1,
      });

      await expect(
        service.adminCreateSearchKeywordChip(actor, { keyword: 'cake' }),
      ).rejects.toThrowDomain('SEARCH_KEYWORD_CHIP_TAKEN');
      await expect(
        service.adminCreateSearchKeywordChip(actor, { keyword: '신년' }),
      ).resolves.toMatchObject({ keyword: '신년' });
      expect(
        await prisma.auditLog.count({
          where: { target_type: 'SEARCH_KEYWORD_CHIP' },
        }),
      ).toBe(1);
    });
  });

  describe('adminUpdateSearchKeywordChip', () => {
    it('전달한 필드만 바꾸고 감사 before/after를 남긴다', async () => {
      const actor = await admin();
      const chip = await createSearchKeywordChip(prisma, {
        keyword: '크리스마스',
        sort_order: 3,
        starts_at: T1,
        ends_at: T2,
      });

      const updated = await service.adminUpdateSearchKeywordChip(actor, {
        chipId: chip.id.toString(),
        isActive: false,
      });

      expect(updated).toMatchObject({
        keyword: '크리스마스',
        sortOrder: 3,
        isActive: false,
        startsAt: T1,
        endsAt: T2,
      });
      const [audit] = await chipAudits(chip.id);
      expect(audit).toMatchObject({
        action: 'UPDATE',
        before_json: { isActive: true, keyword: '크리스마스' },
        after_json: { isActive: false, keyword: '크리스마스' },
      });
      // 키워드를 보내지 않은 수정은 중복 방지 키를 건드리지 않는다
      const row = await prisma.searchKeywordChip.findUniqueOrThrow({
        where: { id: chip.id },
      });
      expect(row.active_key).toBe('크리스마스');
      await expect(
        service.adminCreateSearchKeywordChip(actor, { keyword: '크리스마스' }),
      ).rejects.toThrowDomain('SEARCH_KEYWORD_CHIP_TAKEN');
    });

    it('키워드를 정규화해 바꾸고 active_key도 함께 바꾼다', async () => {
      const actor = await admin();
      const chip = await createSearchKeywordChip(prisma, { keyword: '신년' });

      await service.adminUpdateSearchKeywordChip(actor, {
        chipId: chip.id.toString(),
        keyword: ' 신년   케이크 ',
      });

      const row = await prisma.searchKeywordChip.findUniqueOrThrow({
        where: { id: chip.id },
      });
      expect(row).toMatchObject({
        keyword: '신년 케이크',
        active_key: '신년 케이크',
      });
    });

    it('null 기간은 제한을 없앤다', async () => {
      const actor = await admin();
      const chip = await createSearchKeywordChip(prisma, {
        starts_at: T1,
        ends_at: T2,
      });

      const updated = await service.adminUpdateSearchKeywordChip(actor, {
        chipId: chip.id.toString(),
        startsAt: null,
        endsAt: null,
      });

      expect(updated).toMatchObject({ startsAt: null, endsAt: null });
    });

    it('기간은 현재 값과 병합한 최종 상태로 검증하고, 거절되면 아무것도 바꾸지 않는다', async () => {
      const actor = await admin();
      const chip = await createSearchKeywordChip(prisma, {
        keyword: '크리스마스',
        starts_at: T2,
      });

      await expect(
        service.adminUpdateSearchKeywordChip(actor, {
          chipId: chip.id.toString(),
          keyword: '바뀌면 안 됨',
          endsAt: T1,
        }),
      ).rejects.toThrowDomain('INVALID_EXPOSURE_WINDOW');
      const row = await prisma.searchKeywordChip.findUniqueOrThrow({
        where: { id: chip.id },
      });
      expect(row).toMatchObject({ keyword: '크리스마스', ends_at: null });
      expect(await chipAudits(chip.id)).toHaveLength(0);
    });

    it.each([
      ['종료는 기존 값 유지 · 시작만 늦춤', [null, T1], { startsAt: T2 }, true],
      ['시작은 기존 값 유지 · 종료만 앞당김', [T2, null], { endsAt: T1 }, true],
      ['같은 시각이 되면 거절', [T1, T2], { endsAt: T1 }, true],
      [
        '명시적 null 시작은 기존 값 대신 null',
        [T2, null],
        { startsAt: null, endsAt: T1 },
        false,
      ],
      [
        '명시적 null 종료는 기존 값 대신 null',
        [null, T1],
        { startsAt: T2, endsAt: null },
        false,
      ],
      ['기존 시작보다 뒤의 종료는 허용', [T1, null], { endsAt: T2 }, false],
    ] as const)(
      '기간 병합 검증: %s',
      async (_label, [startsAt, endsAt], input, rejected) => {
        const actor = await admin();
        const chip = await createSearchKeywordChip(prisma, {
          starts_at: startsAt,
          ends_at: endsAt,
        });
        const update = service.adminUpdateSearchKeywordChip(actor, {
          chipId: chip.id.toString(),
          ...input,
        });

        if (rejected) {
          await expect(update).rejects.toThrowDomain('INVALID_EXPOSURE_WINDOW');
        } else {
          await expect(update).resolves.toMatchObject(input);
        }
      },
    );

    it('동시 수정은 잠금으로 직렬화돼 둘을 합치면 어긋나는 기간이 저장되지 않는다', async () => {
      const actor = await admin();
      const chip = await createSearchKeywordChip(prisma);

      const results = await Promise.allSettled([
        service.adminUpdateSearchKeywordChip(actor, {
          chipId: chip.id.toString(),
          startsAt: T2,
        }),
        service.adminUpdateSearchKeywordChip(actor, {
          chipId: chip.id.toString(),
          endsAt: T1,
        }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const row = await prisma.searchKeywordChip.findUniqueOrThrow({
        where: { id: chip.id },
      });
      expect(row.starts_at === null || row.ends_at === null).toBe(true);
    });

    it('대소문자만 바꾸는 수정은 자기 자신과 충돌하지 않는다', async () => {
      const actor = await admin();
      const chip = await createSearchKeywordChip(prisma, { keyword: 'cake' });

      await expect(
        service.adminUpdateSearchKeywordChip(actor, {
          chipId: chip.id.toString(),
          keyword: 'Cake',
        }),
      ).resolves.toMatchObject({ keyword: 'Cake' });
    });

    it('다른 활성 칩의 키워드는 TAKEN, 삭제된 칩의 키워드로는 바꿀 수 있다', async () => {
      const actor = await admin();
      const chip = await createSearchKeywordChip(prisma, { keyword: '생일' });
      await createSearchKeywordChip(prisma, { keyword: '크리스마스' });
      await createSearchKeywordChip(prisma, {
        keyword: '신년',
        deleted_at: T1,
      });

      await expect(
        service.adminUpdateSearchKeywordChip(actor, {
          chipId: chip.id.toString(),
          keyword: '크리스마스',
        }),
      ).rejects.toThrowDomain('SEARCH_KEYWORD_CHIP_TAKEN');
      await expect(
        service.adminUpdateSearchKeywordChip(actor, {
          chipId: chip.id.toString(),
          keyword: '신년',
        }),
      ).resolves.toMatchObject({ keyword: '신년' });
    });

    it('없거나 삭제된 칩이면 NOT_FOUND', async () => {
      const actor = await admin();
      const deleted = await createSearchKeywordChip(prisma, { deleted_at: T1 });

      for (const chipId of [deleted.id.toString(), '999999']) {
        await expect(
          service.adminUpdateSearchKeywordChip(actor, {
            chipId,
            isActive: false,
          }),
        ).rejects.toThrowDomain('SEARCH_KEYWORD_CHIP_NOT_FOUND');
      }
    });
  });

  describe('adminDeleteSearchKeywordChip', () => {
    it('soft-delete하고 active_key를 비워 같은 키워드로 다시 만들 수 있게 한다', async () => {
      const actor = await admin();
      const chip = await createSearchKeywordChip(prisma, { keyword: '2026' });

      await expect(
        service.adminDeleteSearchKeywordChip(actor, chip.id),
      ).resolves.toBe(true);

      const row = await prisma.searchKeywordChip.findUniqueOrThrow({
        where: { id: chip.id },
      });
      expect(row.deleted_at).not.toBeNull();
      expect(row.active_key).toBeNull();
      const [audit] = await chipAudits(chip.id);
      expect(audit).toMatchObject({
        action: 'DELETE',
        before_json: { keyword: '2026' },
      });
      await expect(
        service.adminCreateSearchKeywordChip(actor, { keyword: '2026' }),
      ).resolves.toMatchObject({ keyword: '2026' });
    });

    it('두 관리자가 동시에 삭제해도 감사는 1건이고 한쪽은 NOT_FOUND', async () => {
      const chip = await createSearchKeywordChip(prisma);
      const [a, b] = [await admin(), await admin()];

      const results = await Promise.allSettled([
        service.adminDeleteSearchKeywordChip(a, chip.id),
        service.adminDeleteSearchKeywordChip(b, chip.id),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(await chipAudits(chip.id)).toHaveLength(1);
    });

    it('없거나 이미 삭제된 칩이면 NOT_FOUND', async () => {
      const actor = await admin();
      const chip = await createSearchKeywordChip(prisma);
      await service.adminDeleteSearchKeywordChip(actor, chip.id);

      await expect(
        service.adminDeleteSearchKeywordChip(actor, chip.id),
      ).rejects.toThrowDomain('SEARCH_KEYWORD_CHIP_NOT_FOUND');
      await expect(
        service.adminDeleteSearchKeywordChip(actor, BigInt(999999)),
      ).rejects.toThrowDomain('SEARCH_KEYWORD_CHIP_NOT_FOUND');
      expect(await chipAudits(chip.id)).toHaveLength(1);
    });
  });

  describe('adminReorderSearchKeywordChips', () => {
    async function threeChips() {
      const a = await createSearchKeywordChip(prisma, {
        keyword: 'a',
        sort_order: 0,
      });
      const b = await createSearchKeywordChip(prisma, {
        keyword: 'b',
        sort_order: 1,
      });
      // 비활성 칩도 순서 목록에 들어간다
      const c = await createSearchKeywordChip(prisma, {
        keyword: 'c',
        sort_order: 2,
        is_active: false,
      });
      return { a, b, c };
    }

    it('배열 순서대로 0부터 다시 매기고 바뀐 칩마다 감사를 남긴다', async () => {
      const actor = await admin();
      const { a, b, c } = await threeChips();

      const rows = await service.adminReorderSearchKeywordChips(actor, {
        chipIds: [c.id, a.id, b.id].map(String),
      });

      expect(rows.map((r) => [r.keyword, r.sortOrder])).toEqual([
        ['c', 0],
        ['a', 1],
        ['b', 2],
      ]);
      const [cAudit] = await chipAudits(c.id);
      expect(cAudit).toMatchObject({
        action: 'UPDATE',
        before_json: { sortOrder: 2 },
        after_json: { sortOrder: 0 },
      });
      expect(
        await prisma.auditLog.count({
          where: { target_type: 'SEARCH_KEYWORD_CHIP' },
        }),
      ).toBe(3);
    });

    it('순서가 그대로인 칩은 갱신·감사하지 않는다', async () => {
      const actor = await admin();
      const { a, b, c } = await threeChips();

      await service.adminReorderSearchKeywordChips(actor, {
        chipIds: [a.id, c.id, b.id].map(String),
      });

      expect(await chipAudits(a.id)).toHaveLength(0);
      expect(await chipAudits(b.id)).toHaveLength(1);
      expect(await chipAudits(c.id)).toHaveLength(1);
    });

    it('순서 변경 뒤 새 칩은 다시 매긴 순서의 맨 뒤에 붙는다', async () => {
      const actor = await admin();
      // 다시 매기기 전 최대값(9)과 후 최대값(2)이 달라야 순서 변경 반영을 가린다
      const a = await createSearchKeywordChip(prisma, { sort_order: 2 });
      const b = await createSearchKeywordChip(prisma, { sort_order: 5 });
      const c = await createSearchKeywordChip(prisma, { sort_order: 9 });
      await service.adminReorderSearchKeywordChips(actor, {
        chipIds: [b.id, a.id, c.id].map(String),
      });

      const created = await service.adminCreateSearchKeywordChip(actor, {
        keyword: 'd',
      });

      expect(created.sortOrder).toBe(3);
    });

    it('중복 ID는 DUPLICATE_IDS', async () => {
      const actor = await admin();
      const { a, b } = await threeChips();

      await expect(
        service.adminReorderSearchKeywordChips(actor, {
          chipIds: [a.id, a.id, b.id].map(String),
        }),
      ).rejects.toThrowDomain('DUPLICATE_IDS');
    });

    it('비활성 칩을 빼고 보내면 IDS_LENGTH_MISMATCH', async () => {
      const actor = await admin();
      const { a, b } = await threeChips();

      await expect(
        service.adminReorderSearchKeywordChips(actor, {
          chipIds: [b.id, a.id].map(String),
        }),
      ).rejects.toThrowDomain('IDS_LENGTH_MISMATCH');
    });

    it('삭제됐거나 없는 칩이 섞이면 INVALID_IDS이고 아무것도 바꾸지 않는다', async () => {
      const actor = await admin();
      const { a, b } = await threeChips();
      const deleted = await createSearchKeywordChip(prisma, { deleted_at: T1 });

      for (const stranger of [deleted.id, BigInt(999999)]) {
        await expect(
          service.adminReorderSearchKeywordChips(actor, {
            chipIds: [b.id, a.id, stranger].map(String),
          }),
        ).rejects.toThrowDomain('INVALID_IDS');
      }
      const rows = await service.adminSearchKeywordChips(actor);
      expect(rows.map((r) => r.keyword)).toEqual(['a', 'b', 'c']);
      expect(
        await prisma.auditLog.count({
          where: { target_type: 'SEARCH_KEYWORD_CHIP' },
        }),
      ).toBe(0);
    });
  });
});
