; Incluído pelo electron-builder (package.json > build > nsis > include).
;
; O próprio Agent grava a inicialização com o Windows (src/main.js,
; app.setLoginItemSettings, valor "SisbandaAgent"). O desinstalador do NSIS
; não sabe disso, então a entrada ficaria órfã apontando para um .exe apagado.

;
; Numa ATUALIZAÇÃO o electron-builder também roda o desinstalador antigo; aí a
; entrada deve ficar (${isUpdated}), senão o Agent deixaria de subir no logon
; até ser aberto manualmente de novo.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SisbandaAgent"
  ${endIf}
!macroend
