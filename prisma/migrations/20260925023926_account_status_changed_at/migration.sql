-- 블랙리스트 버전은 상태 전용 시각이어야 한다(P2 03). updated_at은 프로필 수정·OIDC 로그인 같은 무관한 쓰기로도
-- 올라가 정지·복구의 선후를 뒤집을 수 있다. 정지·복구가 기록하는 시각을 따로 둔다.
ALTER TABLE `account` ADD COLUMN `status_changed_at` DATETIME(3) NULL;

-- backfill: 지금 정지 중인 계정은 마지막 갱신 시각을 상태 변경 시각으로 본다 — 재구축이 TTL 창 안의 정지를 다시 채우도록
UPDATE `account` SET `status_changed_at` = `updated_at` WHERE `status` = 'SUSPENDED';
-- 탈퇴 계정은 탈퇴 시각 — 정지·복구·탈퇴 모두 같은 버전 축을 쓴다
UPDATE `account` SET `status_changed_at` = `deleted_at` WHERE `deleted_at` IS NOT NULL;
-- end backfill
