import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { SearchAdminRepository } from '@/features/search/repositories/search-admin.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createSearchKeywordChip } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SearchAdminRepository (real DB)', () => {
  let repo: SearchAdminRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SearchAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    repo = module.get(SearchAdminRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function auditFactory() {
    const actor = (await createAccount(prisma, { account_type: 'ADMIN' })).id;
    return (row: { id: bigint }) => ({
      actorAccountId: actor,
      storeId: null,
      targetType: 'SEARCH_KEYWORD_CHIP' as const,
      targetId: row.id,
      action: 'CREATE' as const,
    });
  }

  const chipArgs = {
    keyword: '크리스마스',
    isActive: true,
    startsAt: null,
    endsAt: null,
  };

  it('같은 키워드를 동시에 만들면 unique(active_key)가 하나만 남기고 나머지는 keyword-taken이다', async () => {
    const audit = await auditFactory();

    const results = await Promise.all(
      Array.from({ length: 4 }, () => repo.createChip(chipArgs, audit)),
    );

    expect(results.filter((r) => r === 'keyword-taken')).toHaveLength(3);
    expect(await prisma.searchKeywordChip.count()).toBe(1);
    // 실패한 생성은 감사도 함께 되돌린다
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('기간 검증이 던지면 수정·감사를 모두 되돌린다', async () => {
    const audit = await auditFactory();
    const chip = await createSearchKeywordChip(prisma, { keyword: '신년' });

    await expect(
      repo.updateChip(
        { chipId: chip.id, keyword: '바뀌면 안 됨' },
        () => {
          throw new Error('거절');
        },
        audit,
      ),
    ).rejects.toThrow('거절');
    expect(
      (
        await prisma.searchKeywordChip.findUniqueOrThrow({
          where: { id: chip.id },
        })
      ).keyword,
    ).toBe('신년');
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('unique 위반이 아닌 DB 오류는 keyword-taken으로 바꾸지 않고 그대로 던진다', async () => {
    const audit = await auditFactory();
    const chip = await createSearchKeywordChip(prisma, { keyword: '신년' });
    // 서비스 정규화를 건너뛴 200자 초과 값은 컬럼 길이 위반(P2002 아님)이다
    const tooLong = 'x'.repeat(201);

    await expect(
      repo.createChip({ ...chipArgs, keyword: tooLong }, audit),
    ).rejects.toThrow(/too long|P2000/i);
    await expect(
      repo.updateChip({ chipId: chip.id, keyword: tooLong }, () => {}, audit),
    ).rejects.toThrow(/too long|P2000/i);
    expect(await prisma.searchKeywordChip.count()).toBe(1);
  });

  it('삭제가 PK를 잡은 채 deleted_at을 바꾸는 사이 순서 변경이 끼어들어도 교착 없이 삭제가 끝나고 순서 변경은 length-mismatch다', async () => {
    const audit = await auditFactory();
    const a = await createSearchKeywordChip(prisma, { sort_order: 0 });
    const b = await createSearchKeywordChip(prisma, { sort_order: 1 });
    const c = await createSearchKeywordChip(prisma, { sort_order: 2 });
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    // softDeleteChip과 같은 순서(PK 잠금 → 대기 → deleted_at 갱신)를 대기만 늘려 재현한다.
    // 교착 시 남은 트랜잭션의 거절이 테스트 밖으로 새지 않도록 결과를 값으로 받는다
    const deleting = prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM search_keyword_chip
          WHERE id = ${b.id} AND deleted_at IS NULL
          FOR UPDATE`;
        await sleep(600);
        await tx.$executeRaw`
          UPDATE search_keyword_chip
          SET deleted_at = NOW(3), active_key = NULL
          WHERE id = ${b.id}`;
      })
      .then(
        () => 'deleted',
        (error: unknown) => error,
      );
    await sleep(150);
    const reordering = repo
      .reorderChips([c.id, b.id, a.id], audit)
      .catch((error: unknown) => error);

    expect(await deleting).toBe('deleted');
    expect(await reordering).toBe('length-mismatch');
  });
});
