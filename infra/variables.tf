variable "project" {
  description = "Name prefix for all resources"
  type        = string
  default     = "modis-viirs"
}

variable "region" {
  type    = string
  default = "eu-north-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile used by Terraform"
  type        = string
  default     = "hackathon"
}

variable "instance_type" {
  description = "amd64 only: CI builds linux/amd64 images"
  type        = string
  default     = "t3.small"
}

variable "root_volume_size" {
  description = "Root disk size, GB"
  type        = number
  default     = 20
}

variable "ssh_public_key_path" {
  description = "Public half of the deploy key (private half goes to GitHub secret EC2_SSH_KEY)"
  type        = string
  default     = "~/.ssh/modis_deploy.pub"
}

variable "ssh_allowed_cidrs" {
  description = "Who may reach port 22. GitHub-hosted runners have dynamic IPs, so CI deploy needs 0.0.0.0/0 (key-only auth)"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "deploy_dir" {
  description = "Must match DEPLOY_DIR in the CI workflow"
  type        = string
  default     = "/opt/modis-viirs"
}
