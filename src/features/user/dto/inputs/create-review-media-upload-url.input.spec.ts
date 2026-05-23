import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateReviewMediaUploadUrlInput } from '@/features/user/dto/inputs/create-review-media-upload-url.input';

function build(plain: object): CreateReviewMediaUploadUrlInput {
  return plainToInstance(CreateReviewMediaUploadUrlInput, plain);
}

describe('CreateReviewMediaUploadUrlInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({
      mediaType: 'IMAGE',
      contentType: 'image/jpeg',
      contentLength: 1024,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('contentLength 0 거절', async () => {
    const dto = build({
      mediaType: 'IMAGE',
      contentType: 'image/jpeg',
      contentLength: 0,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('contentLength');
  });

  it('mediaType 누락 거절', async () => {
    const dto = build({
      contentType: 'image/jpeg',
      contentLength: 1024,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('mediaType');
  });
});
