// UserProfile.nickname 컬럼 한도 (prisma schema: VarChar(50)).
const MAX_NICKNAME_LENGTH = 50;

// 앱 nickname 정책과 동일한 허용 문자 집합(영문/숫자/한글/_) 외 문자.
const DISALLOWED_CHARS = /[^A-Za-z0-9가-힣_]/g;

/**
 * OIDC 최초 가입 시 사용할 임시 nickname 을 생성한다.
 * (사용자는 온보딩에서 본인 nickname 으로 교체한다.)
 *
 * provider 가 주는 이름/이메일에는 공백·특수문자가 있거나, 길이가 길거나, 흔한 이름이
 * 겹칠 수 있다. 이를 그대로 쓰면 (a) nickname 정책 위반 값 저장, (b) VarChar(50) 초과
 * insert 실패, (c) unique 제약 충돌로 가입 실패가 발생한다. 이를 모두 방지한다:
 *  - 허용 문자만 남기고 제거(공백/특수문자 제거)
 *  - `_{accountId}`(PK) suffix 로 유일성 보장
 *  - VarChar(50) 한도 내로 clamp (suffix 는 보존)
 *
 * @param accountId 생성된 계정 PK (유일성 보장에 사용)
 * @param displayName provider 표시 이름 (kakao nickname / google name 등)
 * @param email provider 이메일 (표시 이름이 없을 때 local part 사용)
 */
export function buildInitialNickname(
  accountId: bigint,
  displayName?: string,
  email?: string,
): string {
  const sanitize = (raw: string): string => raw.replace(DISALLOWED_CHARS, '');

  const fromName = sanitize(displayName?.trim() ?? '');
  const fromEmail = email ? sanitize(email.split('@')[0]) : '';
  const base = fromName || fromEmail || 'user';

  const suffix = `_${accountId.toString()}`;
  const baseMaxLength = Math.max(0, MAX_NICKNAME_LENGTH - suffix.length);
  return `${base.slice(0, baseMaxLength)}${suffix}`;
}
