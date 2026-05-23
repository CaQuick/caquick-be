import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MyNotificationsInput } from '@/features/user/dto/inputs/my-notifications.input';

function build(plain: object): MyNotificationsInput {
  return plainToInstance(MyNotificationsInput, plain);
}

describe('MyNotificationsInput', () => {
  it('unreadOnly true 허용', async () => {
    const dto = build({ unreadOnly: true, offset: 0, limit: 20 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('unreadOnly 누락 허용', async () => {
    const dto = build({ offset: 0, limit: 20 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('unreadOnly 가 boolean 이 아니면 거절', async () => {
    const dto = build({ unreadOnly: 'yes', offset: 0, limit: 20 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('unreadOnly');
  });

  it('상속된 페이지네이션 검증도 적용 (limit > 50)', async () => {
    const dto = build({ unreadOnly: false, offset: 0, limit: 51 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });
});
