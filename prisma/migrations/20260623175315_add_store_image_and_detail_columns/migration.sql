-- AlterTable
ALTER TABLE `store` ADD COLUMN `access_guide_text` VARCHAR(500) NULL,
    ADD COLUMN `regular_closure_text` VARCHAR(200) NULL;

-- CreateTable
CREATE TABLE `store_image` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `image_url` VARCHAR(2048) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_store_image_store`(`store_id`, `sort_order`),
    INDEX `idx_store_image_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `store_image` ADD CONSTRAINT `store_image_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
