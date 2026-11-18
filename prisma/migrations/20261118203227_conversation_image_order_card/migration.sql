-- 채팅 이미지·주문 카드 메시지. 새 컬럼은 모두 nullable이고 enum은 끝에 덧붙여 기존 TEXT·HTML 메시지는 그대로다(백필 없음).
-- AlterTable
ALTER TABLE `store_conversation_message` ADD COLUMN `image_url` VARCHAR(2048) NULL,
    ADD COLUMN `order_card_order_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `order_card_order_number` VARCHAR(30) NULL,
    ADD COLUMN `order_card_pickup_at` DATETIME(3) NULL,
    ADD COLUMN `order_card_product_name` VARCHAR(200) NULL,
    ADD COLUMN `order_card_thumbnail_url` VARCHAR(2048) NULL,
    MODIFY `body_format` ENUM('TEXT', 'HTML', 'IMAGE', 'ORDER_CARD') NOT NULL DEFAULT 'TEXT';
