-- 관리자 화면 표시값 스냅샷. 목록·상세가 다른 도메인(계정·매장)을 조인하지 않게 한다.
ALTER TABLE `store` ADD COLUMN `seller_label_snapshot` VARCHAR(200) NULL;
ALTER TABLE `review` ADD COLUMN `store_name_snapshot` VARCHAR(200) NULL;
ALTER TABLE `review_report`
  ADD COLUMN `reporter_nickname_snapshot` VARCHAR(50) NULL,
  ADD COLUMN `resolved_by_label_snapshot` VARCHAR(200) NULL;

-- backfill: 계정 라벨은 formatAccountLabel과 같은 규칙 — `이름(아이디)`, 한쪽만 있으면 그 값, 둘 다 없으면 NULL(삭제된 자격증명은 없는 것으로 본다)
UPDATE `store` s
  JOIN (
    SELECT a.id, NULLIF(TRIM(a.name), '') AS n, NULLIF(TRIM(c.username), '') AS u
    FROM `account` a
    LEFT JOIN `account_credential` c ON c.account_id = a.id AND c.deleted_at IS NULL
  ) l ON l.id = s.seller_account_id
  SET s.seller_label_snapshot = IF(l.n IS NOT NULL AND l.u IS NOT NULL, CONCAT(l.n, '(', l.u, ')'), COALESCE(l.n, l.u));
UPDATE `review_report` rr
  JOIN (
    SELECT a.id, NULLIF(TRIM(a.name), '') AS n, NULLIF(TRIM(c.username), '') AS u
    FROM `account` a
    LEFT JOIN `account_credential` c ON c.account_id = a.id AND c.deleted_at IS NULL
  ) l ON l.id = rr.resolved_by_account_id
  SET rr.resolved_by_label_snapshot = IF(l.n IS NOT NULL AND l.u IS NOT NULL, CONCAT(l.n, '(', l.u, ')'), COALESCE(l.n, l.u));
-- 이미 탈퇴한 신고자는 닉네임이 deleted_<id>로 덮여 복원할 수 없다 — NULL로 둔다
UPDATE `review_report` rr
  JOIN `user_profile` up ON up.account_id = rr.reporter_account_id AND up.deleted_at IS NULL
  SET rr.reporter_nickname_snapshot = up.nickname;
-- 리뷰 매장명은 작성 시점 스냅샷과 같은 출처(주문 품목)
UPDATE `review` r
  JOIN `order_item` oi ON oi.id = r.order_item_id
  SET r.store_name_snapshot = oi.store_name_snapshot;
-- end backfill
ALTER TABLE `review` MODIFY `store_name_snapshot` VARCHAR(200) NOT NULL;
