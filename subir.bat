@echo off
cd /d "%~dp0"

git add .
git commit -m "cambio"
git fetch origin
git push --force-with-lease origin main

pause