import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerSendConversationMessageInput } from '@/features/seller/dto/inputs/seller-send-conversation-message.input';

function build(plain: object): SellerSendConversationMessageInput {
  return plainToInstance(SellerSendConversationMessageInput, plain);
}

describe('SellerSendConversationMessageInput', () => {
  it('TEXT 본문 통과', async () => {
    const dto = build({
      conversationId: '1',
      bodyFormat: 'TEXT',
      bodyText: '안녕하세요',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('HTML 본문 통과', async () => {
    const dto = build({
      conversationId: '1',
      bodyFormat: 'HTML',
      bodyHtml: '<p>안녕</p>',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('알 수 없는 bodyFormat 거절', async () => {
    const dto = build({
      conversationId: '1',
      bodyFormat: 'MARKDOWN',
      bodyText: '...',
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('bodyFormat');
  });

  it('conversationId 누락 거절', async () => {
    const dto = build({ bodyFormat: 'TEXT', bodyText: 'x' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('conversationId');
  });
});
