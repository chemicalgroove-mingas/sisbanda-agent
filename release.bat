@echo off
setlocal EnableDelayedExpansion

:: ── Configurações fixas ────────────────────────────────────────────────────
set REPO=chemicalgroove-mingas/sisbanda-agent
set ASSET_NAME=SisbandaAgentSetup.exe
set ASSET_PATH=dist\SisbandaAgentSetup.exe
set DOWNLOAD_URL=https://github.com/%REPO%/releases/latest/download/%ASSET_NAME%
set API_URL=https://sisbanda-backend.onrender.com/api/agent/download
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
set TAG=v%VERSION%

echo.
echo  ============================================
echo    SISBANDA Agent  -  Release %TAG%
echo  ============================================
echo.

:: ── Etapa 1: Atualizar AGENT_VERSION no backend .env ──────────────────────
echo  [1/5] Atualizando AGENT_VERSION no backend...

if not exist "%ENV_FILE%" (
    echo  AVISO: %ENV_FILE% nao encontrado. Pulando atualizacao do .env.
) else (
    set TMPFILE=%TEMP%\sisbanda_env_%RANDOM%.txt
    set FOUND=0

    for /f "usebackq tokens=* delims=" %%L in ("%ENV_FILE%") do (
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
echo  [2/5] Gerando instalador (build.bat)...

call build.bat
if errorlevel 1 (
    echo  ERRO: build.bat falhou. Abortando release.
    exit /b 1
)

if not exist "%ASSET_PATH%" (
    echo  ERRO: %ASSET_PATH% nao encontrado apos o build.
    exit /b 1
)
echo  OK: %ASSET_PATH% verificado.

:: ── Etapa 3: Publicar ou atualizar Release no GitHub ───────────────────────
echo.
echo  [3/5] Publicando Release %TAG% no GitHub...

gh release view "%TAG%" --repo "%REPO%" >nul 2>&1
if errorlevel 1 (
    :: Release nao existe — criar
    echo  INFO: Release %TAG% nao existe. Criando...
    gh release create "%TAG%" ^
        "%ASSET_PATH%#%ASSET_NAME%" ^
        --title "SISBANDA Agent %VERSION%" ^
        --notes "Versao %VERSION% do SISBANDA Agent." ^
        --repo "%REPO%"
    if errorlevel 1 (
        echo  ERRO: falha ao criar Release %TAG%.
        echo  Verifique se o GitHub CLI esta autenticado: gh auth login
        exit /b 1
    )
    echo  OK: Release %TAG% criada.
) else (
    :: Release ja existe — substituir asset
    echo  INFO: Release %TAG% ja existe. Atualizando asset...
    gh release upload "%TAG%" ^
        "%ASSET_PATH%#%ASSET_NAME%" ^
        --clobber ^
        --repo "%REPO%"
    if errorlevel 1 (
        echo  ERRO: falha ao atualizar asset na Release %TAG%.
        exit /b 1
    )
    echo  OK: Asset substituido na Release %TAG%.
)

:: ── Etapa 4: Validar asset no GitHub ───────────────────────────────────────
echo.
echo  [4/5] Validando asset no GitHub...

gh release view "%TAG%" --repo "%REPO%" | findstr "%ASSET_NAME%" >nul 2>&1
if errorlevel 1 (
    echo  ERRO: %ASSET_NAME% NAO encontrado na Release %TAG% apos upload.
    echo  Verifique manualmente: https://github.com/%REPO%/releases/tag/%TAG%
    exit /b 1
)
echo  OK: %ASSET_NAME% confirmado na Release %TAG%.

:: ── Etapa 5: Commit e push ─────────────────────────────────────────────────
echo.
echo  [5/5] Commitando e fazendo push...

git add .

git diff --cached --quiet
if errorlevel 1 (
    git commit -m "chore: release Agent %TAG%"
    git push origin main
    if errorlevel 1 (
        echo  AVISO: git push falhou. Verifique sua conexao ou permissoes.
    ) else (
        echo  OK: codigo enviado para o repositorio.
    )
) else (
    echo  INFO: Nenhuma alteracao local. Push ignorado.
)

:: ── Concluido ──────────────────────────────────────────────────────────────
echo.
echo  ====================================
echo    SISBANDA AGENT PUBLICADO COM SUCESSO
echo  ====================================
echo.
echo  Versao:    %TAG%
echo.
echo  Download:
echo    %DOWNLOAD_URL%
echo.
echo  API:
echo    %API_URL%
echo.
echo  Validar release:
echo    https://github.com/%REPO%/releases/tag/%TAG%
echo.
echo  ====================================
echo.

endlocal
pause
