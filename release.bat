@echo off
setlocal EnableDelayedExpansion

:: ── Configurações fixas ────────────────────────────────────────────────────
set REPO=chemicalgroove-mingas/sisbanda-agent
set DOWNLOAD_URL=https://github.com/%REPO%/releases/latest/download/SisbandaAgentSetup.exe
set ENV_FILE=..\backend\.env

:: ── Validação do argumento ─────────────────────────────────────────────────
if "%~1"=="" (
    echo.
    echo  Uso:  release.bat ^<versao^>
    echo  Ex.:  release.bat 1.0.0
    echo.
    exit /b 1
)

set VERSION=%~1

echo.
echo  ============================================
echo    SISBANDA Agent  -  Release v%VERSION%
echo  ============================================
echo.

:: ── Etapa 1: Atualizar AGENT_VERSION no backend .env ──────────────────────
echo  [1/4] Atualizando AGENT_VERSION no backend...

if not exist "%ENV_FILE%" (
    echo  AVISO: %ENV_FILE% nao encontrado. Pulando.
) else (
    set TMPFILE=%TEMP%\sisbanda_env_%RANDOM%.txt
    set FOUND=0

    for /f "usebackq delims=" %%L in ("%ENV_FILE%") do (
        set "LINE=%%L"
        echo !LINE! | findstr /B "AGENT_VERSION=" >nul 2>&1
        if !errorlevel!==0 (
            echo AGENT_VERSION="%VERSION%">> "!TMPFILE!"
            set FOUND=1
        ) else (
            echo !LINE!>> "!TMPFILE!"
        )
    )

    if !FOUND!==0 (
        echo AGENT_VERSION="%VERSION%">> "!TMPFILE!"
    )

    move /Y "!TMPFILE!" "%ENV_FILE%" >nul
    echo  OK: AGENT_VERSION="%VERSION%" gravado em %ENV_FILE%
)

:: ── Etapa 2: Build ─────────────────────────────────────────────────────────
echo.
echo  [2/4] Gerando instalador (build.bat)...
call build.bat
if errorlevel 1 (
    echo  ERRO: build falhou.
    exit /b 1
)

if not exist "dist\SisbandaAgentSetup.exe" (
    echo  ERRO: dist\SisbandaAgentSetup.exe nao encontrado apos o build.
    exit /b 1
)
echo  OK: dist\SisbandaAgentSetup.exe gerado.

:: ── Etapa 3: Publicar GitHub Release ──────────────────────────────────────
echo.
echo  [3/4] Publicando Release v%VERSION% no GitHub...

gh release create "v%VERSION%" ^
    "dist\SisbandaAgentSetup.exe#SisbandaAgentSetup.exe" ^
    --title "SISBANDA Agent %VERSION%" ^
    --notes "Versao %VERSION% do SISBANDA Agent." ^
    --repo "%REPO%"

if errorlevel 1 (
    echo  ERRO: falha ao criar Release.
    echo  Verifique se o GitHub CLI esta autenticado: gh auth login
    exit /b 1
)
echo  OK: Release v%VERSION% publicada no GitHub.

:: ── Etapa 4: Commit e push ─────────────────────────────────────────────────
echo.
echo  [4/4] Commitando e fazendo push...

git add .

git diff --cached --quiet
if errorlevel 1 (
    git commit -m "chore: release Agent v%VERSION%"
    git push origin main
    if errorlevel 1 (
        echo  AVISO: git push falhou. Verifique sua conexao ou permissoes.
    ) else (
        echo  OK: codigo enviado para o repositorio.
    )
) else (
    echo  INFO: Nenhuma alteracao para commit. Push ignorado.
)

:: ── Concluido ──────────────────────────────────────────────────────────────
echo.
echo  ============================================
echo    Release v%VERSION% concluida com sucesso!
echo  ============================================
echo.
echo  URL de download (cadastrar no Render):
echo.
echo    AGENT_DOWNLOAD_URL = %DOWNLOAD_URL%
echo.

endlocal
pause
