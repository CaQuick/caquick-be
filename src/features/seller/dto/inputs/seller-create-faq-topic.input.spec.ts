import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerCreateFaqTopicInput } from '@/features/seller/dto/inputs/seller-create-faq-topic.input';

function build(plain: object): SellerCreateFaqTopicInput {
  return plainToInstance(SellerCreateFaqTopicInput, plain);
}

describe('SellerCreateFaqTopicInput', () => {
  it('필수 + 선택 필드 통과', async () => {
    const dto = build({
      title: '배송 안내',
      answerHtml: '<p>...</p>',
      sortOrder: 1,
      isActive: true,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('필수만 통과', async () => {
    const dto = build({ title: '제목', answerHtml: '<p>본문</p>' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('title 누락 거절', async () => {
    const dto = build({ answerHtml: 'x' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('title');
  });

  it('answerHtml 누락 거절', async () => {
    const dto = build({ title: '제목' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('answerHtml');
  });

  it('sortOrder 가 정수가 아니면 거절', async () => {
    const dto = build({ title: 't', answerHtml: 'a', sortOrder: 1.5 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('sortOrder');
  });
});
