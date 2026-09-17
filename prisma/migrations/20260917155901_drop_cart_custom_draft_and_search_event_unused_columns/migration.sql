/*
  Warnings:

  - You are about to drop the column `custom_draft_id` on the `order_item` table. All the data in the column will be lost.
  - You are about to drop the column `address_city` on the `search_event` table. All the data in the column will be lost.
  - You are about to drop the column `address_district` on the `search_event` table. All the data in the column will be lost.
  - You are about to drop the column `address_neighborhood` on the `search_event` table. All the data in the column will be lost.
  - You are about to drop the column `category_id` on the `search_event` table. All the data in the column will be lost.
  - You are about to drop the column `context` on the `search_event` table. All the data in the column will be lost.
  - You are about to drop the `cart` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `cart_item` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `cart_item_option_item` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `custom_draft` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `custom_draft_free_edit` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `custom_draft_free_edit_attachment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `custom_draft_text_value` table. If the table is not empty, all the data it contains will be lost.

*/
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
