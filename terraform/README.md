# Terraform — GitHub 레포 설정 관리

이 디렉토리는 `CaQuick/caquick-be` 레포의 GitHub 쪽 설정(레포 옵션, 브랜치 Rulesets 등)을 **Infrastructure as Code**로 관리한다.

## 관리 범위

- 레포 머지 옵션 (`delete_branch_on_merge`, `allow_auto_merge` 등)
- `main` 브랜치 Ruleset (삭제/force push 차단, PR 필수, CI 통과 필수)
- `develop` 브랜치 Ruleset (동일 수준)

> **관리 밖**: 레포 이름/가시성/이슈 탭 등 이미 설정된 값은 `lifecycle.ignore_changes`로 제외 — UI에서 편하게 바꿔도 Terraform이 되돌리지 않는다.

## 사전 준비

```bash
# 1. Terraform 설치
brew install terraform

# 2. GitHub 인증 (gh CLI 토큰 재사용 — classic PAT를 새로 만들 필요 없음)
export GITHUB_TOKEN=$(gh auth token)
```

필요 스코프: `repo` (classic) 또는 `Administration: Read and write` (fine-grained).

## 일상 작업 흐름

```bash
cd terraform

# 초기 1회
terraform init

# 변경 미리보기 (실제 적용 X)
terraform plan

# 적용
terraform apply
```

## 변경 방법

1. `.tf` 파일 수정
2. `terraform plan`으로 diff 확인
3. PR 올려서 리뷰 (설정 변경도 코드 리뷰 대상)
4. 머지 후 `terraform apply` 실행

## State 관리

로컬 state (`terraform.tfstate`) 방식을 쓴다. 협업자가 늘거나 CI에서 apply가 필요해지면 remote backend(S3/Terraform Cloud) 도입을 검토한다.

⚠️ **state 파일은 절대 커밋 금지** (`.gitignore` 처리됨). 파일이 소실되면 `terraform import`로 재구축 가능.

## 긴급 우회

Ruleset이 본인 작업을 막는 긴급 상황이면:

1. GitHub UI에서 임시로 Ruleset 비활성화 (`Enforcement status: Disabled`)
2. 작업 후 재활성화
3. 변경이 코드와 어긋나면 `terraform plan`에서 drift로 잡힘 → 코드 동기화
