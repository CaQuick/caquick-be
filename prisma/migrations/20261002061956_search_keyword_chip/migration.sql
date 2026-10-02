-- 검색 진입 화면 키워드 바로가기 칩(관리자 등록)과 그 감사 대상 타입.
-- 둘 다 순수 추가다: 테이블 신설, audit_log.target_type ENUM은 끝에 값만 덧붙여 기존 행의 저장값이 바뀌지 않는다.

-- AlterTable
ALTER TABLE `audit_log` MODIFY `target_type` ENUM('STORE', 'PRODUCT', 'ORDER', 'CONVERSATION', 'CHANGE_PASSWORD', 'ACCOUNT', 'BANNER', 'CATEGORY', 'TAG', 'REGION', 'REVIEW', 'REVIEW_COMMENT', 'REVIEW_REPORT', 'NOTIFICATION', 'SEARCH_KEYWORD_CHIP') NOT NULL;

-- CreateTable
CREATE TABLE `search_keyword_chip` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `keyword` VARCHAR(200) NOT NULL,
    `active_key` VARCHAR(200) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_search_keyword_chip_sort`(`sort_order`, `id`),
    INDEX `idx_search_keyword_chip_deleted_at`(`deleted_at`),
    UNIQUE INDEX `uk_search_keyword_chip_active`(`active_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
