import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpdateFaqTopicInput } from '@/features/seller/dto/inputs/seller-update-faq-topic.input';

function build(plain: object): SellerUpdateFaqTopicInput {
  return plainToInstance(SellerUpdateFaqTopicInput, plain);
}

describe('SellerUpdateFaqTopicInput', () => {
  it('topicId 만 있어도 통과 (전체 선택 필드)', async () => {
    const dto = build({ topicId: '1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('전체 필드 통과', async () => {
    const dto = build({
      topicId: '1',
      title: 't',
      answerHtml: 'a',
      sortOrder: 2,
      isActive: false,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('topicId 누락 거절', async () => {
    const dto = build({ title: 't' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('topicId');
  });
});
