import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminNotificationBroadcastListInput } from '@/features/notification/dto/inputs/admin-notification-broadcast-list.input';

async function invalidProps(plain: object): Promise<string[]> {
  const errors = await validate(
    plainToInstance(AdminNotificationBroadcastListInput, plain),
  );
  return errors.map((e) => e.property);
}

describe('AdminNotificationBroadcastListInput', () => {
  it.each([
    ['빈 입력', {}],
    [
      '전체 필터',
      { limit: 100, cursor: '12', type: 'MARKETING', targetKind: 'ALL_USERS' },
    ],
    ['ACCOUNT_IDS 필터', { type: 'SYSTEM', targetKind: 'ACCOUNT_IDS' }],
    ['null 필터(전체)', { type: null, targetKind: null }],
  ])('%s는 통과한다', async (_label, plain) => {
    expect(await invalidProps(plain)).toEqual([]);
  });

  it.each([
    ['시스템 이벤트 분류', { type: 'ORDER_STATUS' }, 'type'],
    ['없는 분류', { type: 'PUSH' }, 'type'],
    ['없는 대상 방식', { targetKind: 'SELLERS' }, 'targetKind'],
    ['limit 0', { limit: 0 }, 'limit'],
    ['limit 101', { limit: 101 }, 'limit'],
    ['빈 커서', { cursor: '' }, 'cursor'],
  ])('%s는 거절한다', async (_label, plain, property) => {
    expect(await invalidProps(plain)).toEqual([property]);
  });
});
