-- 주문 품목 커스텀 스냅샷: 방식·바탕·대표 이미지, 문구 자리 표시 이름·좌표·스타일, 자유 편집 영역, 3D 디자인 JSON과 커스텀 이미지.
-- 자유 편집 크롭 이미지는 영역 좌표가 대신해 지운다. 기존 문구·자유 편집은 바탕 전체 영역·검정·가운데로 옮긴다.
-- AlterTable
ALTER TABLE `order_item` ADD COLUMN `custom_mode_snapshot` ENUM('NONE', 'SLOT', 'THREE_D') NOT NULL DEFAULT 'NONE',
    ADD COLUMN `custom_base_image_url_snapshot` VARCHAR(2048) NULL,
    ADD COLUMN `custom_preview_image_url` VARCHAR(2048) NULL;

-- AlterTable
ALTER TABLE `order_item_custom_text` ADD COLUMN `token_id` BIGINT UNSIGNED NULL,
    ADD COLUMN `label_snapshot` VARCHAR(30) NULL,
    ADD COLUMN `pos_x` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `pos_y` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `width` INTEGER NOT NULL DEFAULT 10000,
    ADD COLUMN `height` INTEGER NOT NULL DEFAULT 10000,
    ADD COLUMN `text_color` CHAR(7) NOT NULL DEFAULT '#000000',
    ADD COLUMN `text_align` ENUM('LEFT', 'CENTER', 'RIGHT') NOT NULL DEFAULT 'CENTER',
    MODIFY `value_text` VARCHAR(200) NULL;

-- AlterTable
ALTER TABLE `order_item_custom_free_edit` ADD COLUMN `pos_x` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `pos_y` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `width` INTEGER NOT NULL DEFAULT 10000,
    ADD COLUMN `height` INTEGER NOT NULL DEFAULT 10000;

-- backfill: 표시 이름은 키에서 따오고, 살아 있는 문구·자유 편집이 있는 품목은 슬롯형이다
UPDATE `order_item_custom_text` SET `label_snapshot` = LEFT(`token_key_snapshot`, 30);
UPDATE `order_item` oi SET oi.`custom_mode_snapshot` = 'SLOT'
WHERE EXISTS (SELECT 1 FROM `order_item_custom_text` t WHERE t.`order_item_id` = oi.`id` AND t.`deleted_at` IS NULL)
   OR EXISTS (SELECT 1 FROM `order_item_custom_free_edit` f WHERE f.`order_item_id` = oi.`id` AND f.`deleted_at` IS NULL);
-- end backfill

-- 새 행은 주문 생성이 값을 모두 채운다
-- AlterTable
ALTER TABLE `order_item_custom_text` MODIFY `label_snapshot` VARCHAR(30) NOT NULL,
    ALTER COLUMN `pos_x` DROP DEFAULT,
    ALTER COLUMN `pos_y` DROP DEFAULT,
    ALTER COLUMN `width` DROP DEFAULT,
    ALTER COLUMN `height` DROP DEFAULT,
    ALTER COLUMN `text_color` DROP DEFAULT,
    ALTER COLUMN `text_align` DROP DEFAULT;

-- AlterTable
ALTER TABLE `order_item_custom_free_edit` ALTER COLUMN `pos_x` DROP DEFAULT,
    ALTER COLUMN `pos_y` DROP DEFAULT,
    ALTER COLUMN `width` DROP DEFAULT,
    ALTER COLUMN `height` DROP DEFAULT,
    DROP COLUMN `crop_image_url`;

-- CreateTable
CREATE TABLE `order_item_custom_design` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_item_id` BIGINT UNSIGNED NOT NULL,
    `schema_version` SMALLINT UNSIGNED NOT NULL,
    `design_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uk_order_item_custom_design_item`(`order_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_item_custom_image` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_item_id` BIGINT UNSIGNED NOT NULL,
    `kind` ENUM('THREE_D_TOP', 'THREE_D_FRONT', 'THREE_D_BACK', 'THREE_D_LEFT', 'THREE_D_RIGHT', 'SLOT_COMPOSITE') NOT NULL,
    `image_url` VARCHAR(2048) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uk_order_item_custom_image_kind`(`order_item_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `order_item_custom_design` ADD CONSTRAINT `order_item_custom_design_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_custom_image` ADD CONSTRAINT `order_item_custom_image_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
