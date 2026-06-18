-- AlterTable
ALTER TABLE `store` ADD COLUMN `region_id` BIGINT UNSIGNED NULL;

-- CreateTable
CREATE TABLE `region` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `parent_id` BIGINT UNSIGNED NULL,
    `level` TINYINT UNSIGNED NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `center_lat` DECIMAL(10, 7) NULL,
    `center_lng` DECIMAL(10, 7) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `region_slug_key`(`slug`),
    INDEX `idx_region_parent_sort`(`parent_id`, `sort_order`),
    INDEX `idx_region_level_active`(`level`, `is_active`),
    INDEX `idx_region_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `idx_store_region_id` ON `store`(`region_id`);

-- AddForeignKey
ALTER TABLE `region` ADD CONSTRAINT `region_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `region`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store` ADD CONSTRAINT `store_region_id_fkey` FOREIGN KEY (`region_id`) REFERENCES `region`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
