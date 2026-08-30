import { anonymizeReviewAuthor } from '@/common/utils/review-author';

describe('anonymizeReviewAuthor', () => {
  it('활성 프로필은 닉네임/이미지를 그대로 노출한다', () => {
    expect(
      anonymizeReviewAuthor({
        nickname: '단골손님',
        profile_image_url: 'https://img/1.png',
        deleted_at: null,
      }),
    ).toEqual({ nickname: '단골손님', profileImageUrl: 'https://img/1.png' });
  });

  it('이미지 미선택 쿼리(필드 생략)는 profileImageUrl=null로 정규화한다', () => {
    expect(
      anonymizeReviewAuthor({ nickname: '단골손님', deleted_at: null }),
    ).toEqual({ nickname: '단골손님', profileImageUrl: null });
  });

  it('프로필 미존재·soft-delete는 모두 익명화한다', () => {
    expect(anonymizeReviewAuthor(null)).toEqual({
      nickname: null,
      profileImageUrl: null,
    });
    expect(anonymizeReviewAuthor(undefined)).toEqual({
      nickname: null,
      profileImageUrl: null,
    });
    expect(
      anonymizeReviewAuthor({
        nickname: 'deleted_123',
        profile_image_url: 'https://img/1.png',
        deleted_at: new Date(),
      }),
    ).toEqual({ nickname: null, profileImageUrl: null });
  });
});
