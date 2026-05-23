import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateProfileImageUploadUrlInput } from '@/features/user/dto/inputs/create-profile-image-upload-url.input';

function build(plain: object): CreateProfileImageUploadUrlInput {
  return plainToInstance(CreateProfileImageUploadUrlInput, plain);
}

describe('CreateProfileImageUploadUrlInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({ contentType: 'image/jpeg', contentLength: 1024 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('contentLength 음수 거절', async () => {
    const dto = build({ contentType: 'image/jpeg', contentLength: -1 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('contentLength');
  });

  it('contentType 누락 거절', async () => {
    const dto = build({ contentLength: 1024 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('contentType');
  });
});
