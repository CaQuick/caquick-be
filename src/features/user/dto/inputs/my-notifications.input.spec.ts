import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MyNotificationsInput } from '@/features/user/dto/inputs/my-notifications.input';

function build(plain: object): MyNotificationsInput {
  return plainToInstance(MyNotificationsInput, plain);
}

describe('MyNotificationsInput', () => {
  it('unreadOnly·cursor·limit 정상 조합 허용', async () => {
    const dto = build({ unreadOnly: true, cursor: '123:45', limit: 20 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('모든 필드 누락 허용(기본값은 서비스가 처리)', async () => {
    const dto = build({});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('unreadOnly 가 boolean 이 아니면 거절', async () => {
    const dto = build({ unreadOnly: 'yes' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('unreadOnly');
  });

  it('빈 문자열 커서 거절', async () => {
    const dto = build({ cursor: '' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('cursor');
  });

  it('limit > 50 거절', async () => {
    const dto = build({ limit: 51 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });

  it('limit 0 거절', async () => {
    const dto = build({ limit: 0 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });
});
