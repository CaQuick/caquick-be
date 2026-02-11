/*
  Warnings:

  - The values [SELLER] on the enum `store_conversation_message_sender_type` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `store_help_topic` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[seller_account_id]` on the table `store` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE `store_help_topic` DROP FOREIGN KEY `store_help_topic_store_id_fkey`;

-- AlterTable
ALTER TABLE `account` MODIFY `status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE `notification` ADD COLUMN `event` ENUM('REVIEW_LIKED', 'ORDER_CONFIRMED', 'ORDER_MADE', 'ORDER_PICKED_UP') NULL;

-- AlterTable
ALTER TABLE `store` MODIFY `min_lead_time_minutes` INTEGER UNSIGNED NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE `store_conversation_message` MODIFY `sender_type` ENUM('USER', 'STORE', 'SYSTEM') NOT NULL;

-- DropTable
DROP TABLE `store_help_topic`;

-- CreateTable
CREATE TABLE `store_faq_topic` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `answer_html` TEXT NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_store_faq_store_active_sort`(`store_id`, `is_active`, `sort_order`),
    INDEX `idx_store_faq_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_daily_capacity` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `capacity_date` DATE NOT NULL,
    `capacity` SMALLINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_store_daily_capacity_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_store_daily_capacity`(`store_id`, `capacity_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `actor_account_id` BIGINT UNSIGNED NOT NULL,
    `store_id` BIGINT UNSIGNED NULL,
    `target_type` ENUM('STORE', 'PRODUCT', 'ORDER', 'CONVERSATION') NOT NULL,
    `target_id` BIGINT UNSIGNED NOT NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE') NOT NULL,
    `before_json` JSON NULL,
    `after_json` JSON NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_audit_actor_time`(`actor_account_id`, `created_at`),
    INDEX `idx_audit_store_time`(`store_id`, `created_at`),
    INDEX `idx_audit_target_time`(`target_type`, `target_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `store_seller_account_id_key` ON `store`(`seller_account_id`);

-- AddForeignKey
ALTER TABLE `store_faq_topic` ADD CONSTRAINT `store_faq_topic_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_daily_capacity` ADD CONSTRAINT `store_daily_capacity_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
