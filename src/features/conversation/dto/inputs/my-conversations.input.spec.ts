import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MyConversationsInput } from '@/features/conversation/dto/inputs/my-conversations.input';

function build(plain: object): MyConversationsInput {
  return plainToInstance(MyConversationsInput, plain);
}

describe('MyConversationsInput', () => {
  it('모든 필드 누락 허용(기본값은 서비스가 처리)', async () => {
    expect(await validate(build({}))).toHaveLength(0);
  });

  it('빈 문자열 커서 거절', async () => {
    const errors = await validate(build({ cursor: '' }));
    expect(errors.map((e) => e.property)).toEqual(['cursor']);
  });

  it('limit 상한(50) 초과 거절', async () => {
    const errors = await validate(build({ limit: 51 }));
    expect(errors.map((e) => e.property)).toEqual(['limit']);
  });
});
