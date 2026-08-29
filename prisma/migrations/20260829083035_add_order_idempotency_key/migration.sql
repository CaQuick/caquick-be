-- AlterTable
ALTER TABLE `order` ADD COLUMN `idempotency_key` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `uk_order_account_idempotency` ON `order`(`account_id`, `idempotency_key`);

