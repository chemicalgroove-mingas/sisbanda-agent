; SISBANDA Agent - Inno Setup Script (alternativo ao electron-builder)
; Uso: compilar com Inno Setup Compiler após rodar "npm run build --dir"

#define MyAppName      "SISBANDA Agent"
#define MyAppVersion   "1.0.0"
#define MyAppPublisher "Polícia Civil da Paraíba"
#define MyAppURL       "https://sisbanda.pcpb.pb.gov.br"
#define MyAppExeName   "SISBANDA Agent.exe"
#define MyOutputDir    "..\dist"
#define MySourceDir    "..\dist\win-unpacked"

[Setup]
AppId={{8F3A1B2C-4D5E-6F7A-8B9C-0D1E2F3A4B5C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\SisbandaAgent
DefaultGroupName={#MyAppName}
OutputDir={#MyOutputDir}
OutputBaseFilename=SisbandaAgent_Setup_{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon";    Description: "Criar ícone na área de trabalho"; GroupDescription: "Atalhos"; Flags: unchecked
Name: "startupregistry"; Description: "Iniciar automaticamente com o Windows";   GroupDescription: "Inicialização"; Flags: checkedonce

[Files]
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}";        Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Desinstalar Agent";   Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}";  Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run";
  ValueType: string; ValueName: "SisbandaAgent";
  ValueData: """{app}\{#MyAppExeName}""";
  Flags: uninsdeletevalue; Tasks: startupregistry

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Iniciar SISBANDA Agent agora"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill"; Parameters: "/f /im ""{#MyAppExeName}"""; Flags: runhidden

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DeleteFile(ExpandConstant('{localappdata}\SisbandaAgent\config.json'));
  end;
end;
