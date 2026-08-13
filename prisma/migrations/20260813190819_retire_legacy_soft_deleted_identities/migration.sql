-- 스키마 변경 없음. 앞선 마이그레이션이 놓친 잔여 데이터 정리다.
--
-- 20260813183650 은 `deleted_at IS NULL` 인 identity 만 은퇴 처리했다. 그런데 익명화 없이
-- soft-delete 만 된 identity 가 남아 있으면, 로그인 경로는 그 row 를 못 보지만
-- (provider, provider_subject) UNIQUE 는 그대로 자리를 잡고 있어 재가입용 identity 생성이
-- 계속 막힌다 → 해당 소셜 계정은 영구히 409 로 떨어진다.
--
-- 그래서 (a) 탈퇴 계정에 매달린 살아있는 identity 와 (b) 이미 soft-delete 됐지만 원본
-- subject 를 그대로 들고 있는 identity 를 함께 정리한다. 이미 최종 형식
-- (`withdrawn:<accountId>:<sha256 64자리>`) 인 row 는 제외해 재실행에 안전하다.
-- 중간 배포본이 남긴 평문 형식(`withdrawn:<accountId>:<원본 subject>`)도 이 정규식에
-- 걸리지 않으므로 함께 익명화된다.
--
-- soft-delete 된 identity 를 되살리는 코드 경로는 없으므로 deleted_at 은 보존한다
-- (살아있는 row 만 지금 시각으로 은퇴시킨다).
UPDATE `account_identity` `ai`
JOIN `account` `a` ON `a`.`id` = `ai`.`account_id`
SET `ai`.`provider_subject` = CONCAT('withdrawn:', `ai`.`account_id`, ':', SHA2(`ai`.`provider_subject`, 256)),
    `ai`.`deleted_at` = COALESCE(`ai`.`deleted_at`, NOW(3)),
    `ai`.`updated_at` = NOW(3)
WHERE `ai`.`provider_subject` NOT REGEXP '^withdrawn:[0-9]+:[0-9a-f]{64}$'
  AND (`a`.`deleted_at` IS NOT NULL OR `ai`.`deleted_at` IS NOT NULL);
