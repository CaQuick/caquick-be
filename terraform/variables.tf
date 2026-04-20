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
