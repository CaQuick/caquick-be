-- 미사용 스키마 제거 (write 경로 0)
--
-- cart* 3개 · custom_draft* 4개: 애플리케이션에 쓰기 경로가 전혀 없고 읽기는
-- 마이페이지/뷰어 카운트뿐이었다. 장바구니·커스텀 디자인 기능을 구현할 때
-- 다시 설계한다 (미사용 스키마를 서비스 경계 분리에 얹어 옮기는 비용이 더 크다).
--
-- search_event.context/address_*/category_id: 코드가 context='GLOBAL'만 쓰고
-- 나머지 4개 컬럼에는 한 번도 쓰지 않았다. SearchContext enum도 사용처 0.

-- DropForeignKey
ALTER TABLE `cart` DROP FOREIGN KEY `cart_account_id_fkey`;

-- DropForeignKey
ALTER TABLE `cart_item` DROP FOREIGN KEY `cart_item_cart_id_fkey`;

-- DropForeignKey
ALTER TABLE `cart_item` DROP FOREIGN KEY `cart_item_product_id_fkey`;

-- DropForeignKey
ALTER TABLE `cart_item_option_item` DROP FOREIGN KEY `cart_item_option_item_cart_item_id_fkey`;

-- DropForeignKey
ALTER TABLE `cart_item_option_item` DROP FOREIGN KEY `cart_item_option_item_option_item_id_fkey`;

-- DropForeignKey
ALTER TABLE `custom_draft` DROP FOREIGN KEY `custom_draft_account_id_fkey`;

-- DropForeignKey
ALTER TABLE `custom_draft` DROP FOREIGN KEY `custom_draft_product_id_fkey`;

-- DropForeignKey
ALTER TABLE `custom_draft` DROP FOREIGN KEY `custom_draft_template_id_fkey`;

-- DropForeignKey
ALTER TABLE `custom_draft_free_edit` DROP FOREIGN KEY `custom_draft_free_edit_draft_id_fkey`;

-- DropForeignKey
ALTER TABLE `custom_draft_free_edit_attachment` DROP FOREIGN KEY `custom_draft_free_edit_attachment_free_edit_id_fkey`;

-- DropForeignKey
ALTER TABLE `custom_draft_text_value` DROP FOREIGN KEY `custom_draft_text_value_draft_id_fkey`;

-- DropForeignKey
ALTER TABLE `custom_draft_text_value` DROP FOREIGN KEY `custom_draft_text_value_token_id_fkey`;

-- DropForeignKey
ALTER TABLE `order_item` DROP FOREIGN KEY `order_item_custom_draft_id_fkey`;

-- DropForeignKey
ALTER TABLE `search_event` DROP FOREIGN KEY `search_event_category_id_fkey`;

-- DropIndex
DROP INDEX `order_item_custom_draft_id_fkey` ON `order_item`;

-- DropIndex
DROP INDEX `idx_search_event_category_created` ON `search_event`;

-- DropIndex
DROP INDEX `idx_search_event_context_created` ON `search_event`;

-- DropIndex
DROP INDEX `idx_search_event_region_created` ON `search_event`;

-- AlterTable
ALTER TABLE `order_item` DROP COLUMN `custom_draft_id`;

-- AlterTable
ALTER TABLE `search_event` DROP COLUMN `address_city`,
    DROP COLUMN `address_district`,
    DROP COLUMN `address_neighborhood`,
    DROP COLUMN `category_id`,
    DROP COLUMN `context`;

-- DropTable
DROP TABLE `cart`;

-- DropTable
DROP TABLE `cart_item`;

-- DropTable
DROP TABLE `cart_item_option_item`;

-- DropTable
DROP TABLE `custom_draft`;

-- DropTable
DROP TABLE `custom_draft_free_edit`;

-- DropTable
DROP TABLE `custom_draft_free_edit_attachment`;

-- DropTable
DROP TABLE `custom_draft_text_value`;

