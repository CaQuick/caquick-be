-- 트랜잭셔널 outbox(P1-08a). 도메인 write와 같은 tx에 이벤트를 적재하고 인프로세스 디스패처가 소비자에게 전달한다.
-- cross-domain FK 금지 — aggregate_id·actor_account_id는 관계 없이 값만 둔다.
CREATE TABLE `outbox` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` CHAR(36) NOT NULL,
    `aggregate_type` VARCHAR(64) NOT NULL,
    `aggregate_id` VARCHAR(64) NOT NULL,
    `event_type` VARCHAR(64) NOT NULL,
    `payload_json` JSON NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `actor_account_id` BIGINT UNSIGNED NULL,
    `client_ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(512) NULL,
    `status` ENUM('PENDING', 'PUBLISHED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uk_outbox_event`(`event_id`),
    INDEX `idx_outbox_dispatch`(`status`, `next_attempt_at`, `id`),
    INDEX `idx_outbox_partition`(`aggregate_type`, `aggregate_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
