# mysqldump(MySQL 8 정품 클라이언트) + aws cli v2. 08에서 실패 경보·복구 runbook·spec을 더한다.
FROM mysql:8.0
# 베이스(Oracle Linux 9)에 curl·ca-certificates는 이미 있다 — curl-minimal을 더 깔면 충돌한다
RUN microdnf install -y unzip \
  && microdnf clean all \
  && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscli.zip \
  && unzip -q /tmp/awscli.zip -d /tmp \
  && /tmp/aws/install \
  && rm -rf /tmp/aws /tmp/awscli.zip
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/bin/bash", "/usr/local/bin/backup.sh"]
