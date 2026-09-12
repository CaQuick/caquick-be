-- seller_credential → account_credential: 판매자 전용이던 username/password 자격증명을
-- SELLER/ADMIN 공용으로 일반화한다. 데이터 보존을 위해 DROP/CREATE 대신 RENAME.

-- RenameTable
ALTER TABLE `seller_credential` RENAME TO `account_credential`;

-- RenameColumn
ALTER TABLE `account_credential` RENAME COLUMN `seller_account_id` TO `account_id`;

-- AddColumn
ALTER TABLE `account_credential` ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false;

-- RenameIndex (Prisma 기본 명명 규칙에 맞춘다)
ALTER TABLE `account_credential` RENAME INDEX `seller_credential_seller_account_id_key` TO `account_credential_account_id_key`;
ALTER TABLE `account_credential` RENAME INDEX `seller_credential_username_key` TO `account_credential_username_key`;
ALTER TABLE `account_credential` RENAME INDEX `idx_seller_credential_deleted_at` TO `idx_account_credential_deleted_at`;

-- RenameForeignKey
ALTER TABLE `account_credential` DROP FOREIGN KEY `seller_credential_seller_account_id_fkey`;
ALTER TABLE `account_credential` ADD CONSTRAINT `account_credential_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
