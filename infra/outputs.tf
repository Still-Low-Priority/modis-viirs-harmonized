output "public_ip" {
  description = "GitHub secret EC2_HOST"
  value       = aws_eip.app.public_ip
}

output "ssh_user" {
  description = "GitHub secret EC2_USER"
  value       = "ubuntu"
}

output "ssh_command" {
  value = "ssh -i ${trimsuffix(pathexpand(var.ssh_public_key_path), ".pub")} ubuntu@${aws_eip.app.public_ip}"
}

output "known_hosts_command" {
  description = "Output of this goes to GitHub secret EC2_KNOWN_HOSTS (run after the instance has booted)"
  value       = "ssh-keyscan -H ${aws_eip.app.public_ip}"
}

output "healthcheck_url" {
  description = "GitHub variable HEALTHCHECK_URL"
  value       = "http://${aws_eip.app.public_ip}/"
}
