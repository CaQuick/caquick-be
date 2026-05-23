import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { WriteReviewMediaInput } from '@/features/user/dto/inputs/write-review-media.input';

function build(plain: object): WriteReviewMediaInput {
  return plainToInstance(WriteReviewMediaInput, plain);
}

describe('WriteReviewMediaInput', () => {
  it('IMAGE + 필수 필드 통과', async () => {
    const dto = build({
      mediaType: 'IMAGE',
      mediaUrl: 'https://x/y.jpg',
      sortOrder: 0,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('VIDEO + thumbnailUrl 통과', async () => {
    const dto = build({
      mediaType: 'VIDEO',
      mediaUrl: 'https://x/y.mp4',
      thumbnailUrl: 'https://x/y-thumb.jpg',
      sortOrder: 0,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('알 수 없는 mediaType 거절', async () => {
    const dto = build({
      mediaType: 'AUDIO',
      mediaUrl: 'https://x/y.mp3',
      sortOrder: 0,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('mediaType');
  });

  it('sortOrder 음수 거절', async () => {
    const dto = build({
      mediaType: 'IMAGE',
      mediaUrl: 'https://x/y.jpg',
      sortOrder: -1,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('sortOrder');
  });
});
