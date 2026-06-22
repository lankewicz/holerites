@echo off
cls
echo Iniciando...
echo.
echo.
echo aguarde alguns segundos...
cd /d "%~dp0"
python extrair_PDF.py
echo Arquivos Gerados!
pause