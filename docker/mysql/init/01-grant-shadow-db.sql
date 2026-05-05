-- Prisma migrate dev는 shadow database를 임시 생성/삭제하므로
-- caquick 유저에게 DB 생성 권한을 부여한다.
GRANT ALL PRIVILEGES ON *.* TO 'caquick'@'%';

-- prisma client 6.x가 일부 환경에서 caching_sha2_password를
-- sha256_password로 잘못 인식하는 호환 이슈가 있어 native_password로 통일.
-- (docker-compose의 --default-authentication-plugin과 이중 안전망)
ALTER USER 'caquick'@'%' IDENTIFIED WITH mysql_native_password BY 'caquick';

FLUSH PRIVILEGES;
