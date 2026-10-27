@echo off
title Metadata Remover (dev)
cd /d "%~dp0"
if not exist "bin\ffmpeg.exe" echo WARNING: bin\ffmpeg.exe is missing
if not exist "node_modules\electron" call npm install
call npm start
if errorlevel 1 pause
