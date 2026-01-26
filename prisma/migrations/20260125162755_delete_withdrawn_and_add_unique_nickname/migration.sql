/*
  Warnings:

  - The values [WITHDRAWN] on the enum `account_status` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[nickname]` on the table `user_profile` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `account` MODIFY `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX `user_profile_nickname_key` ON `user_profile`(`nickname`);
