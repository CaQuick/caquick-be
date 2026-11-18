import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SendConversationImageMessageInput } from '@/features/conversation/dto/inputs/send-conversation-image-message.input';

function build(plain: object): SendConversationImageMessageInput {
  return plainToInstance(SendConversationImageMessageInput, plain);
}

describe('SendConversationImageMessageInput', () => {
  it('storeId·imageUrl 정상 조합 허용', async () => {
    const dto = build({ storeId: '1', imageUrl: 'https://example.com/a.jpg' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['storeId 누락', { imageUrl: 'https://example.com/a.jpg' }, 'storeId'],
    ['imageUrl 빈 문자열', { storeId: '1', imageUrl: '' }, 'imageUrl'],
  ])('%s 거절', async (_label, plain, property) => {
    const errors = await validate(build(plain));
    expect(errors.map((e) => e.property)).toEqual([property]);
  });
});
