import { sha256Hex } from '@/common/utils/crypto';

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
 * 원본 subject 는 provider 가 발급한 안정적인 외부 식별자라 그대로 남기면 탈퇴 계정이
 * 살아있는 소셜 계정과 계속 연결된다. 탈퇴 시 email 을 비우고 nickname 을 치환하는
 * 정책과 어긋나므로 SHA-256 다이제스트로 대체해 복원 불가능하게 만든다.
 *
 * accountId 를 함께 넣는 이유는 두 개 이상의 탈퇴 계정이 같은 소셜 계정을 거쳐 갔을 때
 * 은퇴한 row 끼리 다시 충돌하지 않게 하기 위함이다.
 * (`withdrawn:` + accountId + `:` + 64자 hex → VarChar(255) 한도 안에 항상 들어간다.)
 *
 * DB 마이그레이션의 기존 데이터 정리 SQL 도 같은 규칙(MySQL `SHA2(subject, 256)`)을 쓴다.
 *
 * @param accountId 탈퇴하는 계정 PK
 * @param providerSubject 원본 provider subject
 */
export function buildWithdrawnProviderSubject(
  accountId: bigint,
  providerSubject: string,
): string {
  return `${WITHDRAWN_PREFIX}:${accountId.toString()}:${sha256Hex(providerSubject)}`;
}
