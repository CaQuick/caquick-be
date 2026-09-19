-- order 소유 일일 capacity 복제본(D7-a). catalog의 store_daily_capacity 변경 이벤트로 갱신되며 FK 없음.
-- 주문 생성은 이 테이블만 FOR UPDATE로 잠근다(catalog 행 잠금 0).
CREATE TABLE `order_store_daily_limit` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `booking_date` DATE NOT NULL,
    `capacity` SMALLINT UNSIGNED NOT NULL,
    `source_updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_order_store_daily_limit`(`store_id`, `booking_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- backfill: 활성 설정을 그대로 복제(source_updated_at = 원본 updated_at)
INSERT INTO `order_store_daily_limit` (`store_id`, `booking_date`, `capacity`, `source_updated_at`, `updated_at`)
SELECT `store_id`, `capacity_date`, `capacity`, `updated_at`, CURRENT_TIMESTAMP(3)
FROM `store_daily_capacity`
WHERE `deleted_at` IS NULL;
-- end backfill
