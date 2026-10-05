import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { SellerPushDeviceRepository } from '@/features/notification/repositories/seller-push-device.repository';
import { SellerPushDeviceService } from '@/features/notification/services/seller-push-device.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createSellerPushDevice,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const TOKEN = 'ExponentPushToken[abc-123]';
const T0 = new Date('2026-10-05T09:00:00.000Z');
const T1 = new Date('2026-10-05T10:00:00.000Z');

describe('SellerPushDeviceService (real DB)', () => {
  let service: SellerPushDeviceService;
  let prisma: PrismaClient;
  let now: Date;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerPushDeviceService,
        SellerPushDeviceRepository,
        StoreSellerRepository,
        { provide: ClockService, useValue: { now: () => now } },
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(SellerPushDeviceService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    now = T0;
    await truncateAll();
  });

  const register = (accountId: bigint, token = TOKEN, deviceId = 'dev-1') =>
    service.register(accountId, { token, platform: 'IOS', deviceId });

  const unregister = (accountId: bigint, token = TOKEN) =>
    service.unregister(accountId, { token });

  describe('register', () => {
    it('판매자 매장을 store_id로 하는 활성 행 1개를 만든다', async () => {
      const seller = await setupSellerWithStore(prisma);

      await expect(register(seller.account.id)).resolves.toBe(true);

      const rows = await prisma.sellerPushDevice.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        account_id: seller.account.id,
        store_id: seller.store.id,
        expo_push_token: TOKEN,
        platform: 'IOS',
        client_device_id: 'dev-1',
        last_seen_at: T0,
        disabled_at: null,
        disabled_reason: null,
      });
    });

    it('deviceId를 생략하면 client_device_id는 null이다', async () => {
      const seller = await setupSellerWithStore(prisma);
      await service.register(seller.account.id, {
        token: TOKEN,
        platform: 'ANDROID',
      });
      const row = await prisma.sellerPushDevice.findFirstOrThrow();
      expect(row.client_device_id).toBeNull();
      expect(row.platform).toBe('ANDROID');
    });

    it('같은 토큰 재등록은 행을 늘리지 않고 last_seen_at만 갱신한다', async () => {
      const seller = await setupSellerWithStore(prisma);
      await register(seller.account.id);
      const before = await prisma.sellerPushDevice.findFirstOrThrow();

      now = T1;
      await register(seller.account.id);

      const rows = await prisma.sellerPushDevice.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].last_seen_at).toEqual(T1);
      // updated_at은 Prisma가 올리므로 제외하고 나머지는 전부 그대로
      expect({ ...rows[0], last_seen_at: T0, updated_at: null }).toEqual({
        ...before,
        updated_at: null,
      });
    });

    it('해제됐던 토큰을 다시 등록하면 활성으로 돌아온다', async () => {
      const seller = await setupSellerWithStore(prisma);
      await createSellerPushDevice(prisma, {
        account_id: seller.account.id,
        store_id: seller.store.id,
        expo_push_token: TOKEN,
        disabled_at: new Date('2026-10-01T00:00:00.000Z'),
        disabled_reason: 'UNREGISTERED',
      });

      await register(seller.account.id);

      const row = await prisma.sellerPushDevice.findFirstOrThrow();
      expect(row.disabled_at).toBeNull();
      expect(row.disabled_reason).toBeNull();
      expect(row.last_seen_at).toEqual(T0);
    });

    it('다른 판매자가 쓰던 토큰은 현재 판매자가 가져간다(계정·매장 교체, 행 1개)', async () => {
      const previous = await setupSellerWithStore(prisma);
      const me = await setupSellerWithStore(prisma);
      await createSellerPushDevice(prisma, {
        account_id: previous.account.id,
        store_id: previous.store.id,
        expo_push_token: TOKEN,
        platform: 'ANDROID',
      });

      await register(me.account.id, TOKEN, 'dev-me');

      const rows = await prisma.sellerPushDevice.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        account_id: me.account.id,
        store_id: me.store.id,
        platform: 'IOS',
        client_device_id: 'dev-me',
      });
    });

    it('토큰이 다르면 같은 판매자라도 행이 따로 생긴다', async () => {
      const seller = await setupSellerWithStore(prisma);
      await register(seller.account.id, 'ExponentPushToken[one]');
      await register(seller.account.id, 'ExponentPushToken[two]');
      expect(await prisma.sellerPushDevice.count()).toBe(2);
    });

    it('USER 계정이면 SELLER_ONLY', async () => {
      const user = await createAccount(prisma, { account_type: 'USER' });
      await expect(register(user.id)).rejects.toThrowDomain('SELLER_ONLY');
      expect(await prisma.sellerPushDevice.count()).toBe(0);
    });

    it('없는 계정이면 SESSION_ACCOUNT_MISSING', async () => {
      await expect(register(999999n)).rejects.toThrowDomain(
        'SESSION_ACCOUNT_MISSING',
      );
    });

    it('매장 없는 SELLER는 STORE_NOT_FOUND', async () => {
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(register(seller.id)).rejects.toThrowDomain(
        'STORE_NOT_FOUND',
      );
      expect(await prisma.sellerPushDevice.count()).toBe(0);
    });

    it('Expo 형식이 아닌 토큰은 INVALID_PUSH_TOKEN이고 행을 만들지 않는다', async () => {
      const seller = await setupSellerWithStore(prisma);
      await expect(
        register(seller.account.id, 'not-a-token'),
      ).rejects.toThrowDomain('INVALID_PUSH_TOKEN');
      expect(await prisma.sellerPushDevice.count()).toBe(0);
    });
  });

  describe('unregister', () => {
    it('본인 토큰을 UNREGISTERED 사유로 해제한다', async () => {
      const seller = await setupSellerWithStore(prisma);
      await register(seller.account.id);

      now = T1;
      await expect(unregister(seller.account.id)).resolves.toBe(true);

      const row = await prisma.sellerPushDevice.findFirstOrThrow();
      expect(row.disabled_at).toEqual(T1);
      expect(row.disabled_reason).toBe('UNREGISTERED');
    });

    it('이미 해제된 토큰을 다시 해제해도 true이고 첫 해제 시각이 유지된다', async () => {
      const seller = await setupSellerWithStore(prisma);
      await register(seller.account.id);
      await unregister(seller.account.id);

      now = T1;
      await expect(unregister(seller.account.id)).resolves.toBe(true);

      const row = await prisma.sellerPushDevice.findFirstOrThrow();
      expect(row.disabled_at).toEqual(T0);
    });

    it('등록된 적 없는 토큰 해제는 true이고 아무 행도 만들지 않는다', async () => {
      const seller = await setupSellerWithStore(prisma);
      await expect(unregister(seller.account.id)).resolves.toBe(true);
      expect(await prisma.sellerPushDevice.count()).toBe(0);
    });

    it('남의 토큰 해제는 true를 돌려주되 남의 행은 건드리지 않는다', async () => {
      const owner = await setupSellerWithStore(prisma);
      const me = await setupSellerWithStore(prisma);
      await register(owner.account.id);
      const before = await prisma.sellerPushDevice.findFirstOrThrow();

      now = T1;
      await expect(unregister(me.account.id)).resolves.toBe(true);

      const after = await prisma.sellerPushDevice.findFirstOrThrow();
      expect(after).toEqual(before);
      expect(after.disabled_at).toBeNull();
    });

    it('매장 없는 SELLER도 해제할 수 있다(소유권 교체 뒤 남은 본인 행 해제)', async () => {
      const sellerWithoutStore = await createAccount(prisma, {
        account_type: 'SELLER',
      });
      const other = await setupSellerWithStore(prisma);
      await createSellerPushDevice(prisma, {
        account_id: sellerWithoutStore.id,
        store_id: other.store.id,
        expo_push_token: TOKEN,
      });

      await expect(unregister(sellerWithoutStore.id)).resolves.toBe(true);

      const row = await prisma.sellerPushDevice.findFirstOrThrow();
      expect(row.disabled_at).toEqual(T0);
      expect(row.disabled_reason).toBe('UNREGISTERED');
    });

    it('USER 계정이면 SELLER_ONLY', async () => {
      const user = await createAccount(prisma, { account_type: 'USER' });
      await expect(unregister(user.id)).rejects.toThrowDomain('SELLER_ONLY');
    });

    it('없는 계정이면 SESSION_ACCOUNT_MISSING', async () => {
      await expect(unregister(999999n)).rejects.toThrowDomain(
        'SESSION_ACCOUNT_MISSING',
      );
    });
  });
});
