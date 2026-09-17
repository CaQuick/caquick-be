import { sha256Hex } from '@/common/utils/crypto';

const WITHDRAWN_PREFIX = 'withdrawn';

/**
 * 탈퇴 후 같은 소셜 계정으로 다시 로그인하면 재가입(새 account)이 정책인데, account_identity의
 * (provider, provider_subject) UNIQUE는 deleted_at을 보지 않아 soft-delete만으로는 새 row를 만들 수 없다.
 * 그래서 탈퇴 시 subject를 SHA-256 다이제스트로 치환해 UNIQUE를 비우고 복원 불가능하게 만든다(살아있는
 * 소셜 계정과의 연결도 끊는다). accountId를 섞는 이유는 여러 탈퇴 계정이 같은 소셜 계정을 거쳐 갔을 때
 * 은퇴한 row끼리 다시 충돌하지 않게 하기 위함이다(`withdrawn:` + accountId + `:` + 64자 hex는 VarChar(255) 안).
 * DB 마이그레이션의 기존 데이터 정리 SQL도 같은 규칙(MySQL `SHA2(subject, 256)`)을 쓴다.
 */
export function buildWithdrawnProviderSubject(
  accountId: bigint,
  providerSubject: string,
): string {
  return `${WITHDRAWN_PREFIX}:${accountId.toString()}:${sha256Hex(providerSubject)}`;
}
