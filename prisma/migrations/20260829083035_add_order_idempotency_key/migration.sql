-- AlterTable
-- utf8mb4_bin: 대소문자만 다른 키('abc' vs 'ABC')가 같은 키로 취급되지 않게
-- 이진 콜레이션으로 비교·unique를 건다 (릴리즈 리뷰 반영)
ALTER TABLE `order` ADD COLUMN `idempotency_key` VARCHAR(64) COLLATE utf8mb4_bin NULL;

-- CreateIndex
CREATE UNIQUE INDEX `uk_order_account_idempotency` ON `order`(`account_id`, `idempotency_key`);
