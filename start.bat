@echo off
rem All logic lives in tools\launch.ps1. Keep this file pure ASCII on purpose:
rem cmd.exe mis-parses long batch files that contain multibyte characters.
rem %~dp0 ends with a backslash; inside quotes "C:\dir\" escapes the quote and
rem the path picks up a stray ", so strip it before passing it on.
set "PROJECT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch.ps1" -ProjectDir "%PROJECT_DIR:~0,-1%"
