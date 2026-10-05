-- 판매자 앱 Expo 푸시 디바이스(토큰 unique, 소유 계정은 마지막 등록자)와 이벤트×디바이스 전달 추적 행. 계정·매장 FK 없음, 활성 판정은 disabled_at IS NULL.

-- CreateTable
CREATE TABLE `seller_push_device` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `expo_push_token` VARCHAR(200) NOT NULL,
    `platform` ENUM('IOS', 'ANDROID') NOT NULL,
    `client_device_id` VARCHAR(128) NULL,
    `last_seen_at` DATETIME(3) NOT NULL,
    `disabled_at` DATETIME(3) NULL,
    `disabled_reason` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_seller_push_device_store_active`(`store_id`, `disabled_at`),
    INDEX `idx_seller_push_device_account`(`account_id`),
    UNIQUE INDEX `uk_seller_push_device_token`(`expo_push_token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seller_push_delivery` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `source_event_id` CHAR(36) NOT NULL,
    `push_device_id` BIGINT UNSIGNED NOT NULL,
    `status` ENUM('PENDING', 'TICKET_OK', 'TICKET_ERROR', 'RECEIPT_OK', 'RECEIPT_ERROR', 'RECEIPT_UNKNOWN') NOT NULL DEFAULT 'PENDING',
    `ticket_id` VARCHAR(64) NULL,
    `error_code` VARCHAR(64) NULL,
    `sent_at` DATETIME(3) NULL,
    `receipt_checked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_seller_push_delivery_receipt`(`status`, `sent_at`),
    UNIQUE INDEX `uk_seller_push_delivery_event_device`(`source_event_id`, `push_device_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `seller_push_delivery` ADD CONSTRAINT `seller_push_delivery_push_device_id_fkey` FOREIGN KEY (`push_device_id`) REFERENCES `seller_push_device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

