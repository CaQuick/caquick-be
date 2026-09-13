-- CreateTable
CREATE TABLE `review_report` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `reporter_account_id` BIGINT UNSIGNED NOT NULL,
    `review_id` BIGINT UNSIGNED NULL,
    `review_comment_id` BIGINT UNSIGNED NULL,
    `reason` ENUM('SPAM', 'ABUSE', 'INAPPROPRIATE', 'OTHER') NOT NULL,
    `detail` VARCHAR(500) NULL,
    `content_snapshot` VARCHAR(2000) NULL,
    `status` ENUM('PENDING', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `resolved_by_account_id` BIGINT UNSIGNED NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolution_note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_review_report_status_time`(`status`, `created_at`),
    INDEX `idx_review_report_reporter_review`(`reporter_account_id`, `review_id`),
    INDEX `idx_review_report_reporter_comment`(`reporter_account_id`, `review_comment_id`),
    INDEX `idx_review_report_review`(`review_id`),
    INDEX `idx_review_report_comment`(`review_comment_id`),
    INDEX `idx_review_report_resolved_by`(`resolved_by_account_id`),
    INDEX `idx_review_report_deleted_at`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `review_report` ADD CONSTRAINT `review_report_reporter_account_id_fkey` FOREIGN KEY (`reporter_account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_report` ADD CONSTRAINT `review_report_review_id_fkey` FOREIGN KEY (`review_id`) REFERENCES `review`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_report` ADD CONSTRAINT `review_report_review_comment_id_fkey` FOREIGN KEY (`review_comment_id`) REFERENCES `review_comment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review_report` ADD CONSTRAINT `review_report_resolved_by_account_id_fkey` FOREIGN KEY (`resolved_by_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

