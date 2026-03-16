-- Prisma migrate dev는 shadow database를 임시 생성/삭제하므로
-- caquick 유저에게 DB 생성 권한을 부여한다.
GRANT ALL PRIVILEGES ON *.* TO 'caquick'@'%';
FLUSH PRIVILEGES;
