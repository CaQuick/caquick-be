############################################
# 레포 기본 설정
############################################
# 레포 자체는 이미 생성되어 있으므로 data로 참조만 한다 (파괴 방지).
data "github_repository" "this" {
  name = var.repository_name
}

# 머지 동작 관련 옵션만 Terraform으로 관리한다.
# - delete_branch_on_merge: 머지된 PR의 head 브랜치 자동 삭제 (정리 자동화)
# - allow_auto_merge      : CI 통과 후 자동 머지 허용
# - 머지 방식은 현재 관행 유지 (merge commit / squash / rebase 모두 허용)
resource "github_repository" "caquick_be" {
  name        = data.github_repository.this.name
  description = data.github_repository.this.description
  visibility  = data.github_repository.this.visibility

  # 머지 흐름
  allow_merge_commit     = true
  allow_squash_merge     = true
  allow_rebase_merge     = true
  allow_auto_merge       = true
  delete_branch_on_merge = true

  # Dependabot vulnerability alerts 명시적 활성화 (drift 탐지 가능하도록).
  # provider v6.12.0 부터 deprecated 예정 → 상위 버전 마이그레이션 시
  # github_repository_vulnerability_alerts 전용 리소스로 이관 필요.
  vulnerability_alerts = true

  # 기타 플래그는 현재 상태 유지 (drift 방지 목적의 명시)
  has_issues      = data.github_repository.this.has_issues
  has_projects    = data.github_repository.this.has_projects
  has_wiki        = data.github_repository.this.has_wiki
  has_discussions = data.github_repository.this.has_discussions

  # 실수로 인한 레포 전체 삭제 방지. 의도적 삭제가 필요하면 일시적으로 false로 내리고 destroy.
  lifecycle {
    prevent_destroy = true

    ignore_changes = [
      description,
      visibility,
      has_issues,
      has_projects,
      has_wiki,
      has_discussions,
      topics,
      homepage_url,
    ]
  }
}

############################################
# Branch Ruleset: main (운영 브랜치, 가장 강한 보호)
############################################
resource "github_repository_ruleset" "main_protection" {
  name        = "main-protection"
  repository  = data.github_repository.this.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/heads/main"]
      exclude = []
    }
  }

  rules {
    # 삭제 금지
    deletion = true

    # force push 금지
    non_fast_forward = true

    # PR 경유 필수 (직접 push 차단)
    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
    }

    # CI 상태 체크 필수
    required_status_checks {
      strict_required_status_checks_policy = false # branch up-to-date 강제 여부 (꺼두면 merge 편의성 ↑)

      required_check {
        context = "check"
      }
      required_check {
        context = "pr-title"
      }
      required_check {
        context = "coverage-report"
      }
      # CodeQL 정적 보안 분석. 매트릭스 strategy의 job 이름이 그대로 check context가 된다.
      required_check {
        context = "Analyze (javascript-typescript)"
      }
    }
  }
}

############################################
# Branch Ruleset: develop (통합 브랜치, main보다 살짝 느슨)
############################################
resource "github_repository_ruleset" "develop_protection" {
  name        = "develop-protection"
  repository  = data.github_repository.this.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/heads/develop"]
      exclude = []
    }
  }

  # Repository Admin role 보유자는 develop에 직접 push 가능 (PR/CI 우회).
  # 주 use case: release 머지 후 develop을 main HEAD로 fast-forward 동기화.
  # 일반 작업은 여전히 PR + CI 경유 권장. main 보호는 영향받지 않는다.
  # (GitHub Ruleset bypass_actors는 user 직접 지정 불가 — RepositoryRole/Team만 가능)
  bypass_actors {
    actor_id    = 5 # RepositoryRole: Admin
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }

  rules {
    deletion         = true
    non_fast_forward = true

    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
    }

    required_status_checks {
      strict_required_status_checks_policy = false

      required_check {
        context = "check"
      }
      required_check {
        context = "pr-title"
      }
      required_check {
        context = "coverage-report"
      }
      required_check {
        context = "Analyze (javascript-typescript)"
      }
    }
  }
}
