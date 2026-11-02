-- 주문 시점 매장 지역 표기 스냅샷. 내 주문 목록이 store·region을 조인하지 않게 한다.
ALTER TABLE `order_item` ADD COLUMN `store_region_label_snapshot` VARCHAR(200) NULL;

-- backfill: buildRegionLabel과 같은 규칙 — 현재 매장의 시·동(빈 문자열 제외), 둘 다 없으면 2차 지역명.
-- NULLIF(x, '')는 PAD SPACE 콜레이션에서 공백만 있는 값도 비우므로 CHAR_LENGTH로 판정한다.
UPDATE `order_item` oi
  JOIN `store` s ON s.id = oi.store_id
  LEFT JOIN `region` r ON r.id = s.region_id
  SET oi.store_region_label_snapshot = CASE
    WHEN CHAR_LENGTH(s.address_city) > 0 AND CHAR_LENGTH(s.address_neighborhood) > 0
      THEN CONCAT(s.address_city, ' ', s.address_neighborhood)
    WHEN CHAR_LENGTH(s.address_city) > 0 THEN s.address_city
    WHEN CHAR_LENGTH(s.address_neighborhood) > 0 THEN s.address_neighborhood
    ELSE r.name
  END;
-- end backfill
