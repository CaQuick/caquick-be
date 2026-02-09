/*
  Warnings:

  - The values [ORDER] on the enum `notification_type` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `notification` ADD COLUMN `order_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `order_item_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `product_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `review_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `store_id` BIGINT UNSIGNED NULL,
    MODIFY `type` ENUM('ORDER_STATUS', 'REVIEW_LIKE', 'SYSTEM', 'MARKETING') NOT NULL DEFAULT 'SYSTEM';

-- CreateTable
CREATE TABLE `store_wishlist_item` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_store_wishlist_store`(`store_id`),
    INDEX `idx_store_wishlist_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_store_wishlist`(`account_id`, `store_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_like` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `review_id` BIGINT UNSIGNED NOT NULL,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_review_like_review`(`review_id`),
    INDEX `idx_review_like_account`(`account_id`),
    INDEX `idx_review_like_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_review_like`(`review_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_conversation` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `last_message_at` DATETIME(3) NULL,
    `last_read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_store_conversation_account_updated`(`account_id`, `updated_at`),
    INDEX `idx_store_conversation_store_updated`(`store_id`, `updated_at`),
    INDEX `idx_store_conversation_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_store_conversation`(`account_id`, `store_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_conversation_message` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `conversation_id` BIGINT UNSIGNED NOT NULL,
    `sender_type` ENUM('USER', 'SELLER', 'SYSTEM') NOT NULL,
    `sender_account_id` BIGINT UNSIGNED NULL,
    `body_format` ENUM('TEXT', 'HTML') NOT NULL DEFAULT 'TEXT',
    `body_text` TEXT NULL,
    `body_html` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_store_conversation_message_conv_created`(`conversation_id`, `created_at`),
    INDEX `idx_store_conversation_message_sender`(`sender_account_id`),
    INDEX `idx_store_conversation_message_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_help_topic` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `answer_html` TEXT NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_store_help_topic_store`(`store_id`, `is_active`, `sort_order`),
    INDEX `idx_store_help_topic_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `idx_notification_store` ON `notification`(`store_id`);

-- CreateIndex
CREATE INDEX `idx_notification_product` ON `notification`(`product_id`);

-- CreateIndex
CREATE INDEX `idx_notification_order` ON `notification`(`order_id`);

-- CreateIndex
CREATE INDEX `idx_notification_order_item` ON `notification`(`order_item_id`);

-- CreateIndex
CREATE INDEX `idx_notification_review` ON `notification`(`review_id`);

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_review_id_fkey` FOREIGN KEY (`review_id`) REFERENCES `review`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_wishlist_item` ADD CONSTRAINT `store_wishlist_item_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_wishlist_item` ADD CONSTRAINT `store_wishlist_item_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_like` ADD CONSTRAINT `review_like_review_id_fkey` FOREIGN KEY (`review_id`) REFERENCES `review`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_like` ADD CONSTRAINT `review_like_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_conversation` ADD CONSTRAINT `store_conversation_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_conversation` ADD CONSTRAINT `store_conversation_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_conversation_message` ADD CONSTRAINT `store_conversation_message_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `store_conversation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_conversation_message` ADD CONSTRAINT `store_conversation_message_sender_account_id_fkey` FOREIGN KEY (`sender_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_help_topic` ADD CONSTRAINT `store_help_topic_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
