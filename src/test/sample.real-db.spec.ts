import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { truncateAll } from '@/test/db/truncate';
import { createAccount, createUserProfile } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Test DB 인프라 파이프라인 검증용 샘플 스펙.
 *
 * 여기서 녹색이 나와야 PR 1 인프라가 동작한다고 본다.
 */
describe('Test DB infra pipeline', () => {
  let prisma: PrismaClient;
  let clock: ClockService;
  let idGen: IdGenerator;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ClockService, IdGenerator],
    });
    prisma = p;
    clock = module.get(ClockService);
    idGen = module.get(IdGenerator);
  });

  afterAll(async () => {
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Testcontainer MySQL에 실제로 쓰기/읽기가 가능하다', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    const found = await prisma.account.findUnique({
      where: { id: account.id },
    });

    expect(found).not.toBeNull();
    expect(found!.account_type).toBe('USER');
    expect(found!.status).toBe('ACTIVE');
  });

  it('softDelete extension이 적용되어 있다 (deleted_at 자동 필터)', async () => {
    const account = await createAccount(prisma);
    await prisma.account.update({
      where: { id: account.id },
      data: { deleted_at: new Date() },
    });

    // findFirst는 READ_ACTIONS에 포함 → soft-delete 필터 자동 적용
    const foundDefault = await prisma.account.findFirst({
      where: { id: account.id },
    });
    expect(foundDefault).toBeNull();

    // 명시적으로 deleted_at 조건을 주면 조회 가능
    const foundExplicit = await prisma.account.findFirst({
      where: { id: account.id, deleted_at: { not: null } },
    });
    expect(foundExplicit).not.toBeNull();
  });

  it('팩토리 체인이 참조 무결성을 지킨다', async () => {
    const profile = await createUserProfile(prisma);
    expect(profile.account_id).toBeGreaterThan(0n);

    const account = await prisma.account.findUnique({
      where: { id: profile.account_id },
    });
    expect(account).not.toBeNull();
  });

  it('ClockService와 IdGenerator가 DI로 주입된다', () => {
    expect(clock).toBeInstanceOf(ClockService);
    expect(idGen).toBeInstanceOf(IdGenerator);
    expect(typeof clock.now().getTime()).toBe('number');
    expect(idGen.uuid()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
