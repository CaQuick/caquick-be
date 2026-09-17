/**
 * 탈퇴(soft-delete)했거나 프로필이 없는 작성자는 닉네임/프로필 이미지를 노출하지 않는다(null) —
 * 탈퇴 시 nickname이 deleted_<id>로 치환되는 값이 그대로 노출되는 것도 이 정책이 가린다.
 */

export interface ReviewAuthorProfile {
  nickname: string;
  profile_image_url?: string | null;
  deleted_at: Date | null;
}

export function anonymizeReviewAuthor(
  profile: ReviewAuthorProfile | null | undefined,
): { nickname: string | null; profileImageUrl: string | null } {
  if (!profile || profile.deleted_at !== null) {
    return { nickname: null, profileImageUrl: null };
  }
  return {
    nickname: profile.nickname,
    profileImageUrl: profile.profile_image_url ?? null,
  };
}
