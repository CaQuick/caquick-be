-- CreateTable
CREATE TABLE `search_keyword_rank_snapshot` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ranked_at` DATETIME(3) NOT NULL,
    `rank` SMALLINT UNSIGNED NOT NULL,
    `keyword` VARCHAR(200) NOT NULL,
    `search_count` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_search_keyword_rank_snapshot_ranked_at`(`ranked_at`),
    UNIQUE INDEX `uk_search_keyword_rank_snapshot`(`ranked_at`, `rank`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
