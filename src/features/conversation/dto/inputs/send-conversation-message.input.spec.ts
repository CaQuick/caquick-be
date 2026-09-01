import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SendConversationMessageInput } from '@/features/conversation/dto/inputs/send-conversation-message.input';

function build(plain: object): SendConversationMessageInput {
  return plainToInstance(SendConversationMessageInput, plain);
}

describe('SendConversationMessageInput', () => {
  it('storeId·bodyText 정상 조합 허용', async () => {
    const dto = build({ storeId: '1', bodyText: '문의합니다' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('storeId 누락 거절', async () => {
    const errors = await validate(build({ bodyText: '문의합니다' }));
    expect(errors.map((e) => e.property)).toEqual(['storeId']);
  });

  it('bodyText 빈 문자열 거절', async () => {
    const errors = await validate(build({ storeId: '1', bodyText: '' }));
    expect(errors.map((e) => e.property)).toEqual(['bodyText']);
  });
});
