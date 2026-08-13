// AccountIdentity.provider_subject 컬럼 한도 (prisma schema: VarChar(255)).
const MAX_PROVIDER_SUBJECT_LENGTH = 255;

/**
 * 은퇴 처리된 provider_subject 임을 나타내는 prefix.
 */
const WITHDRAWN_PREFIX = 'withdrawn';

/**
 * 탈퇴한 계정의 소셜 연동 subject 를 익명화한 값을 만든다.
 *
 * 탈퇴 후 같은 소셜 계정으로 다시 로그인하면 **재가입**(새 account) 이 정책인데,
 * `account_identity` 에는 `(provider, provider_subject)` UNIQUE 가 걸려 있어 soft-delete
 * 만으로는 새 row 를 만들 수 없다(MySQL unique index 는 deleted_at 을 보지 않는다).
 * 그래서 탈퇴 시 subject 자체를 치환해 UNIQUE 를 비워 준다.
 *
 * accountId 를 함께 넣는 이유는 두 개 이상의 탈퇴 계정이 같은 소셜 계정을 거쳐 갔을 때
 * 은퇴한 row 끼리 다시 충돌하지 않게 하기 위함이다.
 *
 * @param accountId 탈퇴하는 계정 PK
 * @param providerSubject 원본 provider subject
 */
export function buildWithdrawnProviderSubject(
  accountId: bigint,
  providerSubject: string,
): string {
  const prefixed = `${WITHDRAWN_PREFIX}:${accountId.toString()}:${providerSubject}`;
  return prefixed.slice(0, MAX_PROVIDER_SUBJECT_LENGTH);
}
