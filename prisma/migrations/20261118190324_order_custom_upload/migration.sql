-- 구매자 커스텀 이미지 presign 발급 기록. 정리 크론이 주문에 쓰이지 않은 객체를 지운다(기존 데이터 없음).
-- CreateTable
CREATE TABLE `order_custom_upload` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `purpose` ENUM('RENDER', 'COMPOSITE', 'REFERENCE') NOT NULL,
    `object_key` VARCHAR(512) NOT NULL,
    `content_type` VARCHAR(50) NOT NULL,
    `content_length` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('PENDING', 'ATTACHED', 'PURGING') NOT NULL DEFAULT 'PENDING',
    `attached_at` DATETIME(3) NULL,
    `purge_started_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_order_custom_upload_key`(`object_key`),
    INDEX `idx_order_custom_upload_status_created`(`status`, `created_at`),
    INDEX `idx_order_custom_upload_status_purge`(`status`, `purge_started_at`),
    INDEX `idx_order_custom_upload_account`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

