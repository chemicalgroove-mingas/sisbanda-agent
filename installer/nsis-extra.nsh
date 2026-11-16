; Incluído pelo electron-builder (package.json > build > nsis > include).
;
; O próprio Agent grava a inicialização com o Windows (src/main.js,
; app.setLoginItemSettings, valor "SisbandaAgent"). O desinstalador do NSIS
; não sabe disso, então a entrada ficaria órfã apontando para um .exe apagado.
;
; As credenciais do SEAD (src/services/credenciais.js) ficam cifradas em
; %APPDATA%\SisbandaAgent\credenciais.dat. Desinstalar apaga esse arquivo;
; config.json, logs e screenshots continuam.
;
; Numa ATUALIZAÇÃO o electron-builder também roda o desinstalador antigo; aí a
; entrada do Run e as credenciais devem ficar (${isUpdated}), senão o Agent
; deixaria de subir no logon e o usuário teria de cadastrar a senha de novo.
; O instalador é por usuário (perMachine=false): $APPDATA é o Roaming de quem
; desinstala.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SisbandaAgent"
    Delete "$APPDATA\SisbandaAgent\credenciais.dat"
    Delete "$APPDATA\SisbandaAgent\credenciais.dat.tmp"
  ${endIf}
!macroend
