import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SendConversationFaqMessageInput } from '@/features/conversation/dto/inputs/send-conversation-faq-message.input';

function build(plain: object): SendConversationFaqMessageInput {
  return plainToInstance(SendConversationFaqMessageInput, plain);
}

describe('SendConversationFaqMessageInput', () => {
  it('storeId·faqTopicId 정상 조합 허용', async () => {
    const dto = build({ storeId: '1', faqTopicId: '2' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('faqTopicId 누락 거절', async () => {
    const errors = await validate(build({ storeId: '1' }));
    expect(errors.map((e) => e.property)).toEqual(['faqTopicId']);
  });

  it('storeId 빈 문자열 거절', async () => {
    const errors = await validate(build({ storeId: '', faqTopicId: '2' }));
    expect(errors.map((e) => e.property)).toEqual(['storeId']);
  });
});
