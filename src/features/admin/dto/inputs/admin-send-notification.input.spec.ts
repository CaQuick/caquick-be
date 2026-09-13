import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminSendNotificationInput } from '@/features/admin/dto/inputs/admin-send-notification.input';

function build(plain: object): AdminSendNotificationInput {
  return plainToInstance(AdminSendNotificationInput, plain);
}

const base = { type: 'SYSTEM', title: 't', body: 'b' };

describe('AdminSendNotificationInput', () => {
  it('ALL_USERS는 accountIds 없이 통과', async () => {
    expect(
      await validate(build({ ...base, targetKind: 'ALL_USERS' })),
    ).toHaveLength(0);
  });

  it.each([
    ['누락', undefined],
    ['빈 배열', []],
    ['501개', Array.from({ length: 501 }, (_, i) => String(i))],
  ])('ACCOUNT_IDS인데 accountIds %s 거절', async (_label, accountIds) => {
    const errors = await validate(
      build({ ...base, targetKind: 'ACCOUNT_IDS', accountIds }),
    );
    expect(errors.map((e) => e.property)).toEqual(['accountIds']);
  });

  it.each(['ORDER_STATUS', 'REVIEW_LIKE', 'PUSH'])(
    'type %s 거절(시스템 이벤트 분류는 보낼 수 없다)',
    async (type) => {
      const errors = await validate(
        build({ ...base, type, targetKind: 'ALL_USERS' }),
      );
      expect(errors.map((e) => e.property)).toEqual(['type']);
    },
  );
});
