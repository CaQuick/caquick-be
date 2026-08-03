import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { WriteReviewCommentInput } from '@/features/user/dto/inputs/write-review-comment.input';

function build(plain: object): WriteReviewCommentInput {
  return plainToInstance(WriteReviewCommentInput, plain);
}

describe('WriteReviewCommentInput', () => {
  it('필수 필드 통과', async () => {
    const dto = build({ reviewId: '123', content: '너무 귀여워요' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('content는 trim 후 길이를 검증한다(공백만 입력 거절)', async () => {
    const dto = build({ reviewId: '123', content: '   ' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('content');
  });

  it('content 500자 초과 거절', async () => {
    const dto = build({ reviewId: '123', content: 'a'.repeat(501) });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('content');
  });

  it('trim 결과 500자 이내면 통과', async () => {
    const dto = build({ reviewId: '123', content: `  ${'a'.repeat(500)}  ` });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('content가 문자열이 아니면 거절(transform은 원값 유지)', async () => {
    const dto = build({ reviewId: '123', content: 123 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('content');
  });
});
