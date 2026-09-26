-- 알림센터 표시값 스냅샷 컬럼(P1-07a). 조회가 store·product·order를 조인하지 않게 생성 시점 값을 저장한다.
ALTER TABLE `notification`
  ADD COLUMN `store_name` VARCHAR(200) NULL,
  ADD COLUMN `product_name` VARCHAR(200) NULL,
  ADD COLUMN `order_number` VARCHAR(30) NULL;

-- backfill: 기존 알림을 조회 시 폴백 규칙과 같은 우선순위로 채운다.
-- (1) 직접 연결된 매장·상품 이름
UPDATE `notification` n
  JOIN `store` s ON s.id = n.store_id
  SET n.store_name = s.store_name;
UPDATE `notification` n
  JOIN `product` p ON p.id = n.product_id
  SET n.product_name = p.name;
-- (2) 주문 알림: 주문번호 + 첫 품목의 주문 시점 상품명(개명에도 안전)·매장. 연관 ID를 안 남긴 과거 알림은 여기서 ID까지 채운다.
UPDATE `notification` n
  JOIN `order` o ON o.id = n.order_id
  SET n.order_number = o.order_number;
UPDATE `notification` n
  JOIN (
    SELECT oi.order_id, oi.store_id, oi.product_id, oi.product_name_snapshot
    FROM `order_item` oi
    JOIN (SELECT order_id, MIN(id) AS id FROM `order_item` GROUP BY order_id) first_item ON first_item.id = oi.id
  ) fi ON fi.order_id = n.order_id
  LEFT JOIN `store` s ON s.id = fi.store_id
  SET n.product_name = fi.product_name_snapshot,
      n.store_name = COALESCE(n.store_name, s.store_name),
      n.store_id = COALESCE(n.store_id, fi.store_id),
      n.product_id = COALESCE(n.product_id, fi.product_id);
