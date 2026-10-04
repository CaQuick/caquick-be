-- 세션이 발급될 때의 자격증명 버전(password_updated_at). refresh가 현재 값과 비교해, 비밀번호 변경과 겹쳐
-- 발급된 세션(변경 트랜잭션의 전 세션 폐기를 비껴간 로그인·회전)을 거절한다.
-- AlterTable
ALTER TABLE `auth_refresh_session` ADD COLUMN `credential_version` DATETIME(3) NULL;

-- 백필하지 않는다: 이미 경쟁으로 살아남은 세션이 있어도 행만으로는 가를 수 없다. null 세션은 비밀번호를 바꾼 적이 있는
-- 계정이면 다음 refresh에서 폐기되고(1회 재로그인), 바꾼 적이 없는 계정(경쟁 불가)은 null끼리 일치해 이어진다.
