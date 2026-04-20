# GitHub provider.
# 인증은 GITHUB_TOKEN 환경변수로 주입한다 (classic PAT: repo 스코프 / fine-grained: Administration:write).
# 로컬 세션에서는 `export GITHUB_TOKEN=$(gh auth token)` 으로 gh CLI 토큰을 그대로 재사용할 수 있다.
provider "github" {
  owner = var.github_owner
}
