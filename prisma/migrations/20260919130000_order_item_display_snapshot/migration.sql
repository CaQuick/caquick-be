-- 주문 시점 표시 스냅샷(P1-16). 주문 목록·상세·리뷰 가능 목록이 store·product_image를 조인하지 않게 한다.
ALTER TABLE `order_item`
  ADD COLUMN `store_name_snapshot` VARCHAR(200) NULL,
  ADD COLUMN `product_thumbnail_url_snapshot` VARCHAR(2048) NULL;

-- backfill: 조회가 하던 규칙 그대로 — 매장명은 현재 매장, 썸네일은 활성 상품 이미지 첫 장(sort_order·id 순)
UPDATE `order_item` oi
  JOIN `store` s ON s.id = oi.store_id
  SET oi.store_name_snapshot = s.store_name;
UPDATE `order_item` oi
  SET oi.product_thumbnail_url_snapshot = (
    SELECT pi.image_url
    FROM `product_image` pi
    WHERE pi.product_id = oi.product_id AND pi.deleted_at IS NULL
    ORDER BY pi.sort_order ASC, pi.id ASC
    LIMIT 1
  );
-- end backfill
ALTER TABLE `order_item` MODIFY `store_name_snapshot` VARCHAR(200) NOT NULL;
