-- 주문 결제·환불·정산 스키마와 입금 대기(PENDING_PAYMENT)·노쇼(NO_SHOW) 상태.
-- enum 값은 끝에 덧붙여 기존 값의 순번을 지킨다(저장값 보존, INSTANT ALTER).
-- AlterTable
ALTER TABLE `audit_log` MODIFY `target_type` ENUM('STORE', 'PRODUCT', 'ORDER', 'CONVERSATION', 'CHANGE_PASSWORD', 'ACCOUNT', 'BANNER', 'CATEGORY', 'TAG', 'REGION', 'REVIEW', 'REVIEW_COMMENT', 'REVIEW_REPORT', 'NOTIFICATION', 'SEARCH_KEYWORD_CHIP', 'PAYMENT_SETTING', 'SETTLEMENT_ACCOUNT', 'SETTLEMENT', 'REFUND', 'DEPOSIT_RECORD') NOT NULL;

-- AlterTable
ALTER TABLE `notification` MODIFY `event` ENUM('REVIEW_LIKED', 'ORDER_CONFIRMED', 'ORDER_MADE', 'ORDER_PICKED_UP', 'ORDER_CANCELED', 'ORDER_PAYMENT_CONFIRMED', 'ORDER_PAYMENT_EXPIRED', 'ORDER_NO_SHOW', 'ORDER_PICKUP_RESCHEDULED', 'REFUND_ACCOUNT_REQUESTED', 'REFUND_COMPLETED') NULL;

-- AlterTable
ALTER TABLE `order` ADD COLUMN `commission_amount` INTEGER UNSIGNED NULL,
    ADD COLUMN `commission_rate_bps` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN `confirm_deadline_at` DATETIME(3) NULL,
    ADD COLUMN `confirm_reminder_sent_at` DATETIME(3) NULL,
    ADD COLUMN `idempotency_input_hash` CHAR(64) NULL,
    ADD COLUMN `no_show_at` DATETIME(3) NULL,
    ADD COLUMN `request_note` VARCHAR(500) NULL,
    ADD COLUMN `settlement_base_amount` INTEGER UNSIGNED NULL,
    ADD COLUMN `settlement_finalized_at` DATETIME(3) NULL,
    ADD COLUMN `settlement_id` BIGINT UNSIGNED NULL,
    MODIFY `status` ENUM('SUBMITTED', 'CONFIRMED', 'MADE', 'PICKED_UP', 'CANCELED', 'PENDING_PAYMENT', 'NO_SHOW') NOT NULL DEFAULT 'PENDING_PAYMENT';

-- AlterTable
ALTER TABLE `order_status_history` ADD COLUMN `actor_account_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `actor_type` ENUM('BUYER', 'SELLER', 'ADMIN', 'SYSTEM') NULL,
    ADD COLUMN `cancel_fault` ENUM('SELLER', 'BUYER') NULL,
    ADD COLUMN `cancel_reason` ENUM('DESIGN_NOT_FEASIBLE', 'OUT_OF_MATERIALS', 'SCHEDULE_UNAVAILABLE', 'INAPPROPRIATE_REQUEST', 'BUYER_REQUEST', 'OTHER', 'PAYMENT_NOT_RECEIVED', 'CONFIRM_TIMEOUT') NULL,
    ADD COLUMN `refund_amount` INTEGER UNSIGNED NULL,
    MODIFY `from_status` ENUM('SUBMITTED', 'CONFIRMED', 'MADE', 'PICKED_UP', 'CANCELED', 'PENDING_PAYMENT', 'NO_SHOW') NULL,
    MODIFY `to_status` ENUM('SUBMITTED', 'CONFIRMED', 'MADE', 'PICKED_UP', 'CANCELED', 'PENDING_PAYMENT', 'NO_SHOW') NOT NULL;

-- CreateTable
CREATE TABLE `payment` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `method` ENUM('BANK_TRANSFER', 'TOSS') NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'CANCELED') NOT NULL DEFAULT 'PENDING',
    `amount` INTEGER UNSIGNED NOT NULL,
    `depositor_name` VARCHAR(20) NOT NULL,
    `deposit_bank_code` CHAR(3) NOT NULL,
    `deposit_account_number` VARCHAR(30) NOT NULL,
    `deposit_account_holder` VARCHAR(50) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `buyer_claimed_at` DATETIME(3) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `confirm_source` ENUM('AUTO', 'ADMIN') NULL,
    `confirmed_by_account_id` BIGINT UNSIGNED NULL,
    `confirmed_by_label_snapshot` VARCHAR(200) NULL,
    `confirm_note` VARCHAR(500) NULL,
    `canceled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_payment_order`(`order_id`),
    INDEX `idx_payment_status_claimed_expires`(`status`, `buyer_claimed_at`, `expires_at`),
    INDEX `idx_payment_status_amount`(`status`, `amount`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refund` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `kind` ENUM('CANCEL', 'DEPOSIT_RETURN') NOT NULL,
    `cancel_order_id` BIGINT UNSIGNED NULL,
    `deposit_record_id` BIGINT UNSIGNED NULL,
    `amount` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('AWAITING_ACCOUNT', 'AWAITING_TRANSFER', 'COMPLETED') NOT NULL DEFAULT 'AWAITING_ACCOUNT',
    `bank_code` CHAR(3) NULL,
    `account_holder` VARCHAR(50) NULL,
    `account_number_enc` VARCHAR(255) NULL,
    `account_number_last4` CHAR(4) NULL,
    `account_submitted_at` DATETIME(3) NULL,
    `requested_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `completed_by_account_id` BIGINT UNSIGNED NULL,
    `completed_by_label_snapshot` VARCHAR(200) NULL,
    `complete_note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_refund_cancel_order`(`cancel_order_id`),
    UNIQUE INDEX `uk_refund_deposit_record`(`deposit_record_id`),
    INDEX `idx_refund_order`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deposit_record` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `kind` ENUM('RETURN', 'UNIDENTIFIED') NOT NULL,
    `order_id` BIGINT UNSIGNED NULL,
    `amount` INTEGER UNSIGNED NOT NULL,
    `depositor_name` VARCHAR(50) NOT NULL,
    `deposited_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NULL,
    `recorded_by_account_id` BIGINT UNSIGNED NOT NULL,
    `recorded_by_label_snapshot` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_deposit_record_kind_created`(`kind`, `created_at`),
    INDEX `idx_deposit_record_order`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settlement` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `store_name_snapshot` VARCHAR(200) NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `order_count` INTEGER UNSIGNED NOT NULL,
    `settlement_base_amount` INTEGER UNSIGNED NOT NULL,
    `commission_amount` INTEGER UNSIGNED NOT NULL,
    `payout_amount` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('PENDING', 'PAID') NOT NULL DEFAULT 'PENDING',
    `paid_at` DATETIME(3) NULL,
    `paid_by_account_id` BIGINT UNSIGNED NULL,
    `paid_by_label_snapshot` VARCHAR(200) NULL,
    `paid_note` VARCHAR(500) NULL,
    `paid_bank_code` CHAR(3) NULL,
    `paid_account_holder` VARCHAR(50) NULL,
    `paid_account_number_enc` VARCHAR(255) NULL,
    `paid_account_last4` CHAR(4) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_settlement_store_period`(`store_id`, `period_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_settlement_account` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT UNSIGNED NOT NULL,
    `bank_code` CHAR(3) NOT NULL,
    `account_holder` VARCHAR(50) NOT NULL,
    `account_number_enc` VARCHAR(255) NOT NULL,
    `account_number_last4` CHAR(4) NOT NULL,
    `updated_by_account_id` BIGINT UNSIGNED NOT NULL,
    `updated_by_role` ENUM('BUYER', 'SELLER', 'ADMIN', 'SYSTEM') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_store_settlement_account_store`(`store_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_setting` (
    `id` INTEGER NOT NULL,
    `commission_rate_bps` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `deposit_bank_code` CHAR(3) NULL,
    `deposit_account_number` VARCHAR(30) NULL,
    `deposit_account_holder` VARCHAR(50) NULL,
    `updated_by_account_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_pickup_change` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `from_pickup_at` DATETIME(3) NOT NULL,
    `to_pickup_at` DATETIME(3) NOT NULL,
    `changed_by_account_id` BIGINT UNSIGNED NOT NULL,
    `note` VARCHAR(500) NULL,
    `changed_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_order_pickup_change_order`(`order_id`, `changed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `idx_order_status_confirm_deadline` ON `order`(`status`, `confirm_deadline_at`);

-- CreateIndex
CREATE INDEX `idx_order_status_pickup` ON `order`(`status`, `pickup_at`);

-- CreateIndex
CREATE INDEX `idx_order_settlement` ON `order`(`settlement_id`, `settlement_finalized_at`);

-- CreateIndex
CREATE INDEX `idx_order_account_status` ON `order`(`account_id`, `status`);

-- AddForeignKey
ALTER TABLE `order` ADD CONSTRAINT `order_settlement_id_fkey` FOREIGN KEY (`settlement_id`) REFERENCES `settlement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `payment_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund` ADD CONSTRAINT `refund_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund` ADD CONSTRAINT `refund_deposit_record_id_fkey` FOREIGN KEY (`deposit_record_id`) REFERENCES `deposit_record`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deposit_record` ADD CONSTRAINT `deposit_record_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `settlement` ADD CONSTRAINT `settlement_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_settlement_account` ADD CONSTRAINT `store_settlement_account_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_pickup_change` ADD CONSTRAINT `order_pickup_change_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- backfill: 기존 이력의 주체는 메모로 가린다(관리자 취소만 '[관리자] ' 접두). 기존 취소는 사유 기타·환불 0.
UPDATE `order_status_history` SET `actor_type` = CASE
  WHEN `from_status` IS NULL THEN 'BUYER'
  WHEN `note` LIKE '[관리자] %' THEN 'ADMIN'
  ELSE 'SELLER'
END;
UPDATE `order_status_history` SET `cancel_reason` = 'OTHER', `refund_amount` = 0 WHERE `to_status` = 'CANCELED';
-- 판매자 노출은 submitted_at으로 가린다. 결제 도입 전 주문은 전부 접수된 주문이다
UPDATE `order` SET `submitted_at` = `created_at` WHERE `submitted_at` IS NULL AND `status` <> 'PENDING_PAYMENT';
INSERT INTO `payment_setting` (`id`, `commission_rate_bps`, `created_at`, `updated_at`) VALUES (1, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
-- end backfill
ALTER TABLE `order_status_history` MODIFY `actor_type` ENUM('BUYER', 'SELLER', 'ADMIN', 'SYSTEM') NOT NULL;
