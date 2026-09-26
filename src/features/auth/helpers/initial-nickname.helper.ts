const MAX_NICKNAME_LENGTH = 50;

const DISALLOWED_CHARS = /[^A-Za-z0-9가-힣_]/g;

/**
 * provider가 주는 이름/이메일은 공백·특수문자·긴 길이·흔한 이름 충돌이 있어 그대로 쓰면 nickname 정책 위반,
 * VarChar(50) 초과, unique 충돌로 가입이 실패한다 — 허용 문자만 남기고 `_{accountId}` suffix로 유일성을 보장하며
 * 50자 안으로 자른다(suffix 보존). 사용자는 온보딩에서 본인 nickname으로 교체한다.
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
