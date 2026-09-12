-- 관리자 조작 감사 대상 추가. 기존 값은 그대로 두고 뒤에 덧붙인다(기존 row 무영향).
-- AlterTable
ALTER TABLE `audit_log` MODIFY `target_type` ENUM('STORE', 'PRODUCT', 'ORDER', 'CONVERSATION', 'CHANGE_PASSWORD', 'ACCOUNT', 'BANNER', 'CATEGORY', 'TAG', 'REGION', 'REVIEW', 'REVIEW_COMMENT', 'REVIEW_REPORT', 'NOTIFICATION') NOT NULL;
