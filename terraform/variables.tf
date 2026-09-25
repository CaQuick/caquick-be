variable "github_owner" {
  description = "GitHub organization (or user) name that owns the repository."
  type        = string
  default     = "CaQuick"
}

variable "repository_name" {
  description = "Target repository name."
  type        = string
  default     = "caquick-be"
}

variable "aws_region" {
  description = "AWS region for S3 buckets and IAM."
  type        = string
  default     = "ap-northeast-2"
}

variable "media_buckets" {
  description = "Existing media buckets (presigned PUT + public read) keyed by environment."
  type        = map(string)
  default = {
    dev  = "caquick-media-dev"
    prod = "caquick-media-prod"
  }
}

variable "backup_bucket" {
  description = "Daily mysqldump destination. Objects expire after 14 days."
  type        = string
  default     = "caquick-db-backup"
}

variable "app_iam_user" {
  description = "IAM user for the app (home server + local dev): media presign only."
  type        = string
  default     = "caquick-app"
}

variable "backup_iam_user" {
  description = "IAM user for the backup container only: backup bucket put/get/list."
  type        = string
  default     = "caquick-backup"
}
