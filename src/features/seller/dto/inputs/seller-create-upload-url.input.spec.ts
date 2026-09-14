import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  SELLER_UPLOAD_PURPOSES,
  SellerCreateUploadUrlInput,
} from '@/features/seller/dto/inputs/seller-create-upload-url.input';

function build(plain: object): SellerCreateUploadUrlInput {
  return plainToInstance(SellerCreateUploadUrlInput, plain);
}

describe('SellerCreateUploadUrlInput', () => {
  const valid = {
    purpose: 'PRODUCT_IMAGE',
    contentType: 'image/jpeg',
    contentLength: 1024,
  };

  it('허용 용도면 통과한다', () => {
    for (const purpose of SELLER_UPLOAD_PURPOSES) {
      expect(validateSync(build({ ...valid, purpose }))).toHaveLength(0);
    }
  });

  /**
   * 판매자가 구매자 소유 영역(프로필·리뷰) key 를 발급받으면 그 계정 prefix 로 파일을
   * 올릴 수 있게 된다. 화이트리스트 밖 용도는 전부 거절해야 한다.
   */
  it.each([
    'PROFILE_IMAGE',
    'REVIEW_IMAGE',
    'REVIEW_VIDEO',
    'BANNER_IMAGE',
    'ANYTHING',
    '',
  ])('허용 밖 용도(%s)는 거절한다', (purpose) => {
    expect(validateSync(build({ ...valid, purpose }))).not.toHaveLength(0);
  });

  it.each([
    { label: 'contentLength 0', patch: { contentLength: 0 } },
    { label: 'contentLength 음수', patch: { contentLength: -1 } },
    { label: 'contentLength 소수', patch: { contentLength: 1.5 } },
    { label: 'contentType 누락', patch: { contentType: undefined } },
  ])('$label 은 거절한다', ({ patch }) => {
    expect(validateSync(build({ ...valid, ...patch }))).not.toHaveLength(0);
  });
});
