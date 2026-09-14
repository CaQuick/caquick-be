import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  ADMIN_UPLOAD_PURPOSES,
  AdminCreateUploadUrlInput,
} from '@/features/admin/dto/inputs/admin-create-upload-url.input';

function build(plain: object): AdminCreateUploadUrlInput {
  return plainToInstance(AdminCreateUploadUrlInput, plain);
}

describe('AdminCreateUploadUrlInput', () => {
  const valid = {
    purpose: 'BANNER_IMAGE',
    contentType: 'image/jpeg',
    contentLength: 1024,
  };

  it('허용 용도면 통과한다', () => {
    for (const purpose of ADMIN_UPLOAD_PURPOSES) {
      expect(validateSync(build({ ...valid, purpose }))).toHaveLength(0);
    }
  });

  // 관리자라도 구매자 소유 영역(프로필·리뷰) key 발급은 허용하지 않는다.
  it.each([
    'PROFILE_IMAGE',
    'REVIEW_IMAGE',
    'REVIEW_VIDEO',
    'PRODUCT_IMAGE',
    'ANYTHING',
    '',
  ])('허용 밖 용도(%s)는 거절한다', (purpose) => {
    expect(validateSync(build({ ...valid, purpose }))).not.toHaveLength(0);
  });

  it.each([
    { label: 'contentLength 0', patch: { contentLength: 0 } },
    { label: 'contentLength 음수', patch: { contentLength: -1 } },
    { label: 'contentType 누락', patch: { contentType: undefined } },
  ])('$label 은 거절한다', ({ patch }) => {
    expect(validateSync(build({ ...valid, ...patch }))).not.toHaveLength(0);
  });
});
