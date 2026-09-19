-- 리뷰 작성 시점의 주문 품목 스냅샷(P1-07b). 목록·상세·쇼케이스가 order_item(·option_item·custom_free_edit)을 조인하지 않게 한다.
ALTER TABLE `review`
  ADD COLUMN `product_name_snapshot` VARCHAR(200) NULL,
  ADD COLUMN `option_summary` JSON NULL,
  ADD COLUMN `before_image_url` VARCHAR(2048) NULL;

-- backfill: 조회가 하던 규칙 그대로 — 상품명은 품목 스냅샷, 옵션은 활성 option_item(id 순), before 이미지는 활성 free_edit 첫 장(sort_order·id 순)
UPDATE `review` r
  JOIN `order_item` oi ON oi.id = r.order_item_id
  SET r.product_name_snapshot = oi.product_name_snapshot;
UPDATE `review` r
  SET r.option_summary = (
    SELECT JSON_ARRAYAGG(JSON_OBJECT('groupName', o.group_name_snapshot, 'optionTitle', o.option_title_snapshot))
    FROM (
      SELECT group_name_snapshot, option_title_snapshot
      FROM `order_item_option_item`
      WHERE order_item_id = r.order_item_id AND deleted_at IS NULL
      ORDER BY id
    ) o
  );
UPDATE `review` r
  SET r.before_image_url = (
    SELECT fe.crop_image_url
    FROM `order_item_custom_free_edit` fe
    WHERE fe.order_item_id = r.order_item_id AND fe.deleted_at IS NULL
    ORDER BY fe.sort_order ASC, fe.id ASC
    LIMIT 1
  );
-- end backfill
ALTER TABLE `review` MODIFY `product_name_snapshot` VARCHAR(200) NOT NULL;
