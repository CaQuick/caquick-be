############################################
# AWS — S3(미디어·백업) + 앱 IAM 사용자 (로드맵 v2 08, M7)
############################################
# 미디어 버킷 2개는 이미 있다. import 블록이 apply 때 state에 연결한다(이미 연결돼 있으면 no-op).
# 설정값은 2026-09-25 실측(공개 읽기 정책·PUT/GET CORS·ACL 차단·BucketOwnerEnforced)을 그대로 옮겼다 — drift 0이 목표.
# 배포 아티팩트 버킷(caquick-deploy-artifacts)은 CodeDeploy와 함께 폐기했다(관리 대상 아님, CLI로 삭제).

############################################
# 미디어 버킷 (dev·prod)
############################################
import {
  for_each = var.media_buckets
  to       = aws_s3_bucket.media[each.key]
  id       = each.value
}
import {
  for_each = var.media_buckets
  to       = aws_s3_bucket_public_access_block.media[each.key]
  id       = each.value
}
import {
  for_each = var.media_buckets
  to       = aws_s3_bucket_ownership_controls.media[each.key]
  id       = each.value
}
import {
  for_each = var.media_buckets
  to       = aws_s3_bucket_policy.media[each.key]
  id       = each.value
}
import {
  for_each = var.media_buckets
  to       = aws_s3_bucket_cors_configuration.media[each.key]
  id       = each.value
}

resource "aws_s3_bucket" "media" {
  for_each = var.media_buckets
  bucket   = each.value

  # 사용자 업로드 원본 — 실수로 destroy되면 복구 불가
  lifecycle {
    prevent_destroy = true
  }
}

# ACL은 막고 버킷 정책의 공개 읽기는 허용한다(앱이 publicUrl을 그대로 저장·노출).
resource "aws_s3_bucket_public_access_block" "media" {
  for_each = var.media_buckets
  bucket   = aws_s3_bucket.media[each.key].id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_ownership_controls" "media" {
  for_each = var.media_buckets
  bucket   = aws_s3_bucket.media[each.key].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_policy" "media" {
  for_each = var.media_buckets
  bucket   = aws_s3_bucket.media[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadGetObject"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.media[each.key].arn}/*"
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.media]
}

# 브라우저가 presigned PUT으로 직접 올린다 — FE 오리진만
resource "aws_s3_bucket_cors_configuration" "media" {
  for_each = var.media_buckets
  bucket   = aws_s3_bucket.media[each.key].id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["http://localhost:3000", "https://www.caquick.site", "https://caquick.site"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

############################################
# DB 백업 버킷 — 매일 mysqldump, 14일 뒤 만료, 버전 없음, 비공개
############################################
resource "aws_s3_bucket" "backup" {
  bucket = var.backup_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket = aws_s3_bucket.backup.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    id     = "expire-mysql-dumps"
    status = "Enabled"

    filter {
      prefix = "mysql/"
    }

    expiration {
      days = 14
    }

    # 끊긴 업로드 조각이 비용으로 남지 않게
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

############################################
# 앱 IAM 사용자 — 홈서버·로컬 앱이 쓰는 키의 주인. 최소 권한: 미디어 presign(put/get) + 백업 put/get/list
############################################
# 액세스 키는 Terraform으로 만들지 않는다 — secret이 state에 남는다. 콘솔/CLI로 발급해 GitHub secret·.env에 넣는다:
#   aws iam create-access-key --user-name caquick-app
resource "aws_iam_user" "app" {
  name = var.app_iam_user
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "MediaPresign"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = [for b in aws_s3_bucket.media : "${b.arn}/*"]
  }

  statement {
    sid       = "BackupObjects"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.backup.arn}/mysql/*"]
  }

  statement {
    sid       = "BackupList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.backup.arn]
  }
}

resource "aws_iam_policy" "app" {
  name        = "CaQuickApp"
  description = "caquick app (home server + local dev): media presign put/get, DB backup put/get/list"
  policy      = data.aws_iam_policy_document.app.json
}

resource "aws_iam_user_policy_attachment" "app" {
  user       = aws_iam_user.app.name
  policy_arn = aws_iam_policy.app.arn
}

output "backup_bucket" {
  value = aws_s3_bucket.backup.bucket
}

output "app_iam_user" {
  value = aws_iam_user.app.name
}
