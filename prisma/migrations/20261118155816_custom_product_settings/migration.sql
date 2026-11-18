-- 상품 커스텀 방식(없음·슬롯형·3D)과 문구 자리 표시 이름·글자색·정렬, 템플릿 자유 편집·revision.
-- 템플릿 활성 토글은 커스텀 방식이, 상품 바탕 이미지는 템플릿 바탕이, 옵션 커스텀 요구 플래그는 커스텀 방식이 대신해 지운다.
-- AlterTable
ALTER TABLE `product` ADD COLUMN `custom_mode` ENUM('NONE', 'SLOT', 'THREE_D') NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE `product_custom_template` ADD COLUMN `free_edit_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `product_custom_text_token` ADD COLUMN `label` VARCHAR(30) NULL,
    ADD COLUMN `text_align` ENUM('LEFT', 'CENTER', 'RIGHT') NOT NULL DEFAULT 'CENTER',
    ADD COLUMN `text_color` CHAR(7) NOT NULL DEFAULT '#000000',
    MODIFY `max_length` SMALLINT UNSIGNED NOT NULL DEFAULT 20;

-- backfill: 활성 템플릿이 있는 상품은 슬롯형이다
UPDATE `product` p JOIN `product_custom_template` t ON t.`product_id` = p.`id` SET p.`custom_mode` = 'SLOT' WHERE t.`is_active` = 1 AND t.`deleted_at` IS NULL;
-- 표시 이름은 키에서 따온다. 기본 문구는 50자에서 자르고, 최대 글자 수는 기본 문구 길이 이상·50 이하로 맞춘다
UPDATE `product_custom_text_token` SET `label` = LEFT(`token_key`, 30);
UPDATE `product_custom_text_token` SET `default_text` = LEFT(`default_text`, 50) WHERE CHAR_LENGTH(`default_text`) > 50;
UPDATE `product_custom_text_token` SET `max_length` = LEAST(50, GREATEST(`max_length`, CHAR_LENGTH(`default_text`), 1));
-- 좌표가 하나라도 없으면 판매자 앱 기본 배치(활성 자리 순서대로 위에서 2000 간격)로 채운다.
-- 순번은 별도 임시 표로 뽑는다 — 같은 표를 한 문장에서 두 번 읽으면 임시 표(백필 검증)에서 실패한다
CREATE TEMPORARY TABLE `_custom_text_token_rank` AS
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `template_id` ORDER BY `deleted_at` IS NOT NULL, `sort_order`, `id`) - 1 AS `idx`
  FROM `product_custom_text_token`;
UPDATE `product_custom_text_token` t JOIN `_custom_text_token_rank` r ON r.`id` = t.`id`
SET t.`pos_x` = 1000, t.`pos_y` = LEAST(1000 + r.`idx` * 2000, 8500), t.`width` = 8000, t.`height` = 1500
WHERE t.`pos_x` IS NULL OR t.`pos_y` IS NULL OR t.`width` IS NULL OR t.`height` IS NULL;
DROP TEMPORARY TABLE `_custom_text_token_rank`;
-- 자리는 바탕 안에 둔다(서버 좌표 검증과 같은 범위): 좌표 0~9999, 너비·높이 1 이상, x+w·y+h ≤ 10000
UPDATE `product_custom_text_token` SET `pos_x` = LEAST(GREATEST(`pos_x`, 0), 9999), `pos_y` = LEAST(GREATEST(`pos_y`, 0), 9999);
UPDATE `product_custom_text_token` SET `width` = LEAST(GREATEST(`width`, 1), 10000 - `pos_x`), `height` = LEAST(GREATEST(`height`, 1), 10000 - `pos_y`);
-- end backfill

-- AlterTable
ALTER TABLE `product_custom_text_token` MODIFY `label` VARCHAR(30) NOT NULL,
    MODIFY `pos_x` INTEGER NOT NULL,
    MODIFY `pos_y` INTEGER NOT NULL,
    MODIFY `width` INTEGER NOT NULL,
    MODIFY `height` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `product_custom_template` DROP COLUMN `is_active`;

-- AlterTable
ALTER TABLE `product` DROP COLUMN `base_design_image_url`;

-- AlterTable
ALTER TABLE `product_option_group` DROP COLUMN `option_requires_description`,
    DROP COLUMN `option_requires_image`;
