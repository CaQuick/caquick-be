-- Prisma migrate dev는 shadow database를 임시 생성/삭제하므로
-- caquick 유저에게 DB 생성 권한을 부여한다.
GRANT ALL PRIVILEGES ON *.* TO 'caquick'@'%';

-- caching_sha2_password 는 비TLS 콜드 연결에서 RSA 공개키 조회가 필요하고
-- mariadb 드라이버(Prisma 7 어댑터)가 기본 차단하므로 native_password 로 통일.
-- (docker-compose의 --default-authentication-plugin과 이중 안전망)
ALTER USER 'caquick'@'%' IDENTIFIED WITH mysql_native_password BY 'caquick';

FLUSH PRIVILEGES;
