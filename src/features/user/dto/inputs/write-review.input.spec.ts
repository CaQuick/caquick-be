import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { WriteReviewInput } from '@/features/user/dto/inputs/write-review.input';

function build(plain: object): WriteReviewInput {
  return plainToInstance(WriteReviewInput, plain);
}

describe('WriteReviewInput', () => {
  const goodContent = 'a'.repeat(20);

  it('필수 필드 통과', async () => {
    const dto = build({
      orderItemId: '123',
      rating: 4.5,
      content: goodContent,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('미디어 배열 nested 검증 통과', async () => {
    const dto = build({
      orderItemId: '123',
      rating: 4.5,
      content: goodContent,
      media: [
        {
          mediaType: 'IMAGE',
          mediaUrl: 'https://x/y.jpg',
          sortOrder: 0,
        },
      ],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rating 0.3 단위 거절', async () => {
    const dto = build({
      orderItemId: '123',
      rating: 4.3,
      content: goodContent,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('rating');
  });

  it('content 길이 20 미만 거절', async () => {
    const dto = build({
      orderItemId: '123',
      rating: 4.5,
      content: '짧음',
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('content');
  });

  it('content 길이 1001 초과 거절', async () => {
    const dto = build({
      orderItemId: '123',
      rating: 4.5,
      content: 'a'.repeat(1001),
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('content');
  });

  it('공백만 입력은 trim 후 거절 (빈 리뷰 저장 방지)', async () => {
    const dto = build({
      orderItemId: '123',
      rating: 4.5,
      content: ' '.repeat(30),
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('content');
  });

  it('앞뒤 공백을 제외한 실제 길이로 검증 (raw 길이로 우회 불가)', async () => {
    const dto = build({
      orderItemId: '123',
      rating: 4.5,
      // raw 길이 24 지만 trim 후 18 → 거절
      content: `   ${'a'.repeat(18)}   `,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('content');
  });

  it('앞뒤 공백 포함이어도 trim 후 길이 충족 시 통과', async () => {
    const dto = build({
      orderItemId: '123',
      rating: 4.5,
      content: `  ${'a'.repeat(20)}  `,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('content 가 문자열이 아니면 trim 시도 없이(크래시 없이) IsString 으로 거절', async () => {
    const dto = build({
      orderItemId: '123',
      rating: 4.5,
      content: 12345 as unknown as string,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('content');
  });

  it('미디어 항목 mediaType 오류는 nested 에러로 보고', async () => {
    const dto = build({
      orderItemId: '123',
      rating: 4.5,
      content: goodContent,
      media: [
        {
          mediaType: 'AUDIO',
          mediaUrl: 'https://x/y.mp3',
          sortOrder: 0,
        },
      ],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'media')).toBe(true);
  });
});
