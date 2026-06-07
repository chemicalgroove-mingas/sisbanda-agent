@echo off
echo ==========================================
echo   SISBANDA Agent - Build para Windows
echo ==========================================

echo [1/4] Instalando dependencias...
call npm install
if errorlevel 1 goto erro

echo [2/4] Instalando Chromium do Playwright...
call npx playwright install chromium
if errorlevel 1 goto erro

echo [3/4] Gerando instalador Windows...
call npm run build
if errorlevel 1 goto erro

echo [4/4] Concluido!
echo Instalador gerado em: dist\
goto fim

:erro
echo.
echo ERRO durante o build. Verifique as mensagens acima.
exit /b 1

:fim
pause
