@echo off
setlocal

echo.
echo  ==========================================
echo    SISBANDA Agent - Build para Windows
echo  ==========================================
echo.

echo  [1/4] Instalando dependencias...
call npm install
if errorlevel 1 goto erro

echo.
echo  [2/4] Instalando Chromium do Playwright...
call npx playwright install chromium
if errorlevel 1 goto erro

echo.
echo  [3/4] Gerando instalador Windows (electron-builder)...
call npm run build
if errorlevel 1 goto erro

echo.
echo  [4/4] Verificando instalador...
if not exist "dist\SisbandaAgentSetup.exe" (
    echo  ERRO: dist\SisbandaAgentSetup.exe nao foi gerado.
    echo  Verifique se "artifactName" esta definido em package.json ^> build ^> nsis.
    goto erro
)

echo  OK: dist\SisbandaAgentSetup.exe gerado com sucesso.
echo.
endlocal
exit /b 0

:erro
echo.
echo  ERRO durante o build. Verifique as mensagens acima.
echo.
endlocal
exit /b 1
