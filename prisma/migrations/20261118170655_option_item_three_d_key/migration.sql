-- 옵션 항목을 3D 카탈로그 선택지에 잇는 키. 기존 항목은 연결 없음(NULL)이라 백필이 없다.
-- AlterTable
ALTER TABLE `product_option_item` ADD COLUMN `three_d_key` VARCHAR(40) NULL;
