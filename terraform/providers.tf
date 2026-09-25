# GitHub provider.
# 인증은 GITHUB_TOKEN 환경변수로 주입한다 (classic PAT: repo 스코프 / fine-grained: Administration:write).
# 로컬 세션에서는 `export GITHUB_TOKEN=$(gh auth token)` 으로 gh CLI 토큰을 그대로 재사용할 수 있다.
provider "github" {
  owner = var.github_owner
}

# AWS provider.
# 인증은 환경변수(AWS_ACCESS_KEY_ID·AWS_SECRET_ACCESS_KEY)로 주입한다 — 사람 전용 키(cw7)로만 apply한다.
# 앱·홈서버가 쓰는 키(caquick-app)는 아래 정책으로 S3만 만질 수 있어 Terraform을 돌릴 수 없다(의도).
provider "aws" {
  region = var.aws_region
}
