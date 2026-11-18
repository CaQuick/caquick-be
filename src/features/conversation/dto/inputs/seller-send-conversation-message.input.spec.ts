import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerSendConversationMessageInput } from '@/features/conversation/dto/inputs/seller-send-conversation-message.input';

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

  // ORDER_CARD는 DTO를 통과시켜 service가 INVALID_BODY_FORMAT으로 거절한다
  it.each(['IMAGE', 'ORDER_CARD'])('%s 형식 통과', async (bodyFormat) => {
    const dto = build({
      conversationId: '1',
      bodyFormat,
      imageUrl: 'https://example.com/a.jpg',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('문자열이 아닌 imageUrl 거절', async () => {
    const dto = build({
      conversationId: '1',
      bodyFormat: 'IMAGE',
      imageUrl: 1,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('imageUrl');
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
