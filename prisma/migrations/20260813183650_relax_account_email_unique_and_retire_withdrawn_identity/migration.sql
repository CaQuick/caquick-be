-- DropIndex
DROP INDEX `account_email_key` ON `account`;

-- CreateIndex
CREATE INDEX `idx_account_email` ON `account`(`email`);

-- 아래 두 UPDATE 는 스키마가 아니라 기존 데이터 정리다(수기 추가).
-- 탈퇴 계정의 identity 가 살아있던 탓에 재로그인이 삭제 계정을 다시 집어들었고,
-- 그 트랜잭션이 커밋되며 탈퇴 시 비워둔 email 을 되채워 놓은 상태가 남아 있다.

-- 탈퇴 계정이 도로 점유한 이메일 회수 (탈퇴 정책상 NULL 이어야 한다)
UPDATE `account`
SET `email` = NULL
WHERE `deleted_at` IS NOT NULL AND `email` IS NOT NULL;

-- 탈퇴 계정에 매달린 살아있는 identity 은퇴 처리.
-- (provider, provider_subject) UNIQUE 를 비워 같은 소셜 계정으로 재가입할 수 있게 한다.
-- 원본 subject 는 provider 발급 외부 식별자라 그대로 두면 탈퇴 계정이 살아있는 소셜 계정과
-- 계속 연결된다 → SHA-256 다이제스트로 대체한다(런타임 buildWithdrawnProviderSubject 와 동일 규칙).
UPDATE `account_identity` `ai`
JOIN `account` `a` ON `a`.`id` = `ai`.`account_id`
SET `ai`.`provider_subject` = CONCAT('withdrawn:', `a`.`id`, ':', SHA2(`ai`.`provider_subject`, 256)),
    `ai`.`deleted_at` = NOW(3),
    `ai`.`updated_at` = NOW(3)
WHERE `a`.`deleted_at` IS NOT NULL AND `ai`.`deleted_at` IS NULL;
