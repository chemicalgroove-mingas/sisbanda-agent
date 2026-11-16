@echo off
setlocal

echo.
echo  ==========================================
echo    SISBANDA Agent - Build para Windows
echo  ==========================================
echo.

echo  [1/4] Instalando dependencias (package-lock)...
call npm ci
if errorlevel 1 goto erro

:: Nao ha passo de navegador: o Agent usa o Edge/Chrome do proprio Windows
:: (src/services/navegador.js). Nenhum Chromium e baixado nem empacotado.
echo.
echo  [2/4] Rodando testes...
call npm test
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
