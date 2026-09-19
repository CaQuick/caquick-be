-- outbox 소비자 dedupe(P1-08b): 알림의 생성 원인 이벤트. at-least-once 재전달을 (source_event_id, account_id) unique로 흡수한다.
ALTER TABLE `notification` ADD COLUMN `source_event_id` CHAR(36) NULL;

CREATE UNIQUE INDEX `uk_notification_source_account` ON `notification`(`source_event_id`, `account_id`);
