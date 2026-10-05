-- 판매자 읽음 마커(명시 mutation·답장이 전진)와 구매자 닉네임 표시 스냅샷. 마커는 NULL = "읽은 적 없음"으로 시작한다.
-- AlterTable
ALTER TABLE `store_conversation` ADD COLUMN `buyer_nickname_snapshot` VARCHAR(50) NULL,
    ADD COLUMN `seller_last_read_at` DATETIME(3) NULL;

-- backfill: 생성 시점 값은 복원할 수 없어 현재 활성 프로필의 닉네임으로 채운다. 탈퇴 프로필(deleted_at)은 조인에서 빠져 NULL로 남는다.
UPDATE `store_conversation` c
  JOIN `user_profile` up ON up.account_id = c.account_id AND up.deleted_at IS NULL
  SET c.buyer_nickname_snapshot = NULLIF(up.nickname, '');
-- end backfill
