import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ConversationMessagesInput } from '@/features/conversation/dto/inputs/conversation-messages.input';

function build(plain: object): ConversationMessagesInput {
  return plainToInstance(ConversationMessagesInput, plain);
}

describe('ConversationMessagesInput', () => {
  it('cursor·limit 정상 조합 허용', async () => {
    expect(await validate(build({ cursor: '10', limit: 30 }))).toHaveLength(0);
  });

  it('limit 0 거절', async () => {
    const errors = await validate(build({ limit: 0 }));
    expect(errors.map((e) => e.property)).toEqual(['limit']);
  });

  it('limit 상한(50) 초과 거절', async () => {
    const errors = await validate(build({ limit: 51 }));
    expect(errors.map((e) => e.property)).toEqual(['limit']);
  });
});
