-- 세션이 발급될 때의 자격증명 버전(password_updated_at). refresh가 현재 값과 비교해, 비밀번호 변경과 겹쳐
-- 발급된 세션(변경 트랜잭션의 전 세션 폐기를 비껴간 로그인·회전)을 거절한다.
-- AlterTable
ALTER TABLE `auth_refresh_session` ADD COLUMN `credential_version` DATETIME(3) NULL;

-- backfill: 살아 있는 세션은 모두 마지막 변경 뒤에 발급됐다(변경이 전 세션을 폐기한다) — 현재 버전을 채워 배포 뒤에도 refresh가 이어지게
UPDATE `auth_refresh_session` s
JOIN `account_credential` c ON c.`account_id` = s.`account_id`
SET s.`credential_version` = c.`password_updated_at`
WHERE s.`revoked_at` IS NULL;
-- end backfill
