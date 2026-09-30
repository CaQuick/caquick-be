-- 관리자 알림 발송 이력. 발송 요청 1건(outbox 이벤트 1건)마다 1행.
CREATE TABLE `notification_broadcast` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` CHAR(36) NOT NULL,
    `actor_account_id` BIGINT UNSIGNED NOT NULL,
    `actor_label` VARCHAR(200) NULL,
    `type` ENUM('ORDER_STATUS', 'REVIEW_LIKE', 'SYSTEM', 'MARKETING') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` VARCHAR(2000) NOT NULL,
    `target_kind` ENUM('ALL_USERS', 'ACCOUNT_IDS') NOT NULL,
    `target_count` INTEGER NOT NULL,
    `skipped_count` INTEGER NOT NULL,
    `target_account_ids` JSON NULL,
    `skipped_account_ids` JSON NOT NULL,
    `delivered_count` INTEGER NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_notification_broadcast_type`(`type`, `id`),
    UNIQUE INDEX `uk_notification_broadcast_event`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- backfill: 과거 발송 요청을 outbox payload에서 복원한다. 옛 형식(audience 없음)·분류 밖·행위자 없는 행은 건너뛴다.
-- 이력 id가 요청 순서와 같아야 id desc 목록이 맞으므로 outbox id 순으로 넣는다.
-- 발송자 라벨만 요청 시점이 아니라 현재 이름·아이디다(관리자 이름·아이디는 쓰기 경로가 없어 사실상 같다).
INSERT INTO `notification_broadcast` (
    `event_id`, `actor_account_id`, `actor_label`, `type`, `title`, `body`,
    `target_kind`, `target_count`, `skipped_count`, `target_account_ids`, `skipped_account_ids`, `created_at`
)
SELECT
    o.`event_id`,
    o.`actor_account_id`,
    CASE
        WHEN NULLIF(TRIM(a.`name`), '') IS NOT NULL AND NULLIF(TRIM(c.`username`), '') IS NOT NULL
            THEN CONCAT(TRIM(a.`name`), '(', TRIM(c.`username`), ')')
        ELSE COALESCE(NULLIF(TRIM(a.`name`), ''), NULLIF(TRIM(c.`username`), ''))
    END,
    JSON_UNQUOTE(JSON_EXTRACT(o.`payload_json`, '$.type')),
    JSON_UNQUOTE(JSON_EXTRACT(o.`payload_json`, '$.title')),
    JSON_UNQUOTE(JSON_EXTRACT(o.`payload_json`, '$.body')),
    JSON_UNQUOTE(JSON_EXTRACT(o.`payload_json`, '$.audience.kind')),
    CASE JSON_UNQUOTE(JSON_EXTRACT(o.`payload_json`, '$.audience.kind'))
        WHEN 'ACCOUNT_IDS' THEN COALESCE(JSON_LENGTH(o.`payload_json`, '$.audience.accountIds'), 0)
        ELSE COALESCE(CAST(JSON_EXTRACT(o.`payload_json`, '$.audience.count') AS UNSIGNED), 0)
    END,
    COALESCE(JSON_LENGTH(o.`payload_json`, '$.skippedAccountIds'), 0),
    CASE JSON_UNQUOTE(JSON_EXTRACT(o.`payload_json`, '$.audience.kind'))
        WHEN 'ACCOUNT_IDS' THEN COALESCE(JSON_EXTRACT(o.`payload_json`, '$.audience.accountIds'), JSON_ARRAY())
        ELSE NULL
    END,
    COALESCE(JSON_EXTRACT(o.`payload_json`, '$.skippedAccountIds'), JSON_ARRAY()),
    o.`occurred_at`
FROM `outbox` o
LEFT JOIN `account` a ON a.`id` = o.`actor_account_id`
LEFT JOIN `account_credential` c ON c.`account_id` = o.`actor_account_id` AND c.`deleted_at` IS NULL
WHERE o.`event_type` = 'notification.broadcast_requested'
  AND o.`actor_account_id` IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(o.`payload_json`, '$.audience.kind')) IN ('ALL_USERS', 'ACCOUNT_IDS')
  AND JSON_UNQUOTE(JSON_EXTRACT(o.`payload_json`, '$.type')) IN ('SYSTEM', 'MARKETING')
ORDER BY o.`id`;
-- 실제 저장 수는 source_event_id로 다시 센다(알림센터 조회와 같이 삭제된 알림은 빼고)
UPDATE `notification_broadcast` b
SET b.`delivered_count` = (
    SELECT COUNT(*) FROM `notification` n
    WHERE n.`source_event_id` = b.`event_id` AND n.`deleted_at` IS NULL
);
-- 완료 시각은 근사치: 브로커에 넘어간(PUBLISHED) 요청은 요청 시각을 완료로 본다. PENDING·FAILED는 미완료로 둔다
UPDATE `notification_broadcast` b
JOIN `outbox` o ON o.`event_id` = b.`event_id`
SET b.`completed_at` = o.`occurred_at`
WHERE o.`status` = 'PUBLISHED';
-- end backfill
