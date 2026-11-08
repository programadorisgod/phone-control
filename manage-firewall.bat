@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage-firewall.ps1" %*
