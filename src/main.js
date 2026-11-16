'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path   = require('path');
const os     = require('os');
const logger = require('./services/logger');
const { startServer }        = require('./server');
const { loadConfig, atualizarConfig } = require('./config');
const { VERSION }            = require('./versao');
const { verificarAtualizacao } = require('./services/updater');

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const LOG_DIR   = path.join(os.homedir(), 'AppData', 'Roaming', 'SisbandaAgent', 'logs');

const { ARG_OCULTO, opcoesInicioComWindows } = require('./inicializacao');
const iniciouOculto = process.argv.includes(ARG_OCULTO);

let win  = null;
let tray = null;

// ── Janela principal ────────────────────────────────────────────────────────
// Só é criada depois que o servidor está escutando: antes disso /ui não existe.
function criarJanela(port, mostrar) {
  win = new BrowserWindow({
    width:  460,
    height: 560,
    resizable: false,
    title: 'SISBANDA Agent',
    icon:  ICON_PATH,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    show: false,
  });

  win.loadURL(`http://localhost:${port}/ui`);
  win.setMenuBarVisibility(false);

  if (mostrar) win.once('ready-to-show', () => win.show());

  // Fechar minimiza para bandeja, não encerra
  win.on('close', e => {
    e.preventDefault();
    win.hide();
  });
}

function mostrarJanela() {
  if (!win) return;
  win.show();
  win.focus();
}

// ── Inicialização com o Windows ─────────────────────────────────────────────
function aplicarInicioComWindows(ativo) {
  // Em desenvolvimento (`npm start`) o executável é o electron.exe genérico:
  // registrar isso no Run seria lixo no registro do desenvolvedor.
  if (!app.isPackaged) return;
  app.setLoginItemSettings(opcoesInicioComWindows(ativo, process.execPath));
}

// ── Bandeja do sistema ──────────────────────────────────────────────────────
function criarTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(`SISBANDA Agent v${VERSION}`);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Abrir',
      click: mostrarJanela,
    },
    {
      label: 'Ver Logs',
      click: () => shell.openPath(LOG_DIR),
    },
    { type: 'separator' },
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      checked: loadConfig().iniciarComWindows !== false,
      enabled: app.isPackaged,
      click: item => {
        atualizarConfig({ iniciarComWindows: item.checked });
        aplicarInicioComWindows(item.checked);
        logger.info(`Iniciar com o Windows: ${item.checked ? 'ativado' : 'desativado'}`);
      },
    },
    { type: 'separator' },
    {
      label: 'Reiniciar',
      click: () => { app.relaunch(); app.exit(0); },
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => { app.exit(0); },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', mostrarJanela);
}

// ── Inicialização ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Evita múltiplas instâncias
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }

  app.on('second-instance', mostrarJanela);

  aplicarInicioComWindows(loadConfig().iniciarComWindows !== false);
  criarTray();

  startServer(server => {
    logger.info('Servidor HTTP + WebSocket iniciados.');
    criarJanela(server.address().port, !iniciouOculto);
    // Verifica atualização 5 s após start (não bloqueia inicialização)
    setTimeout(() => verificarAtualizacao().then(u => {
      if (u?.available) logger.info(`Atualização disponível: ${u.version}`);
    }), 5000);
  }, err => {
    const porta = loadConfig().port;
    dialog.showErrorBox(
      'SISBANDA Agent',
      err.code === 'EADDRINUSE'
        ? `A porta ${porta} já está em uso por outro programa. O Agent não pôde iniciar.`
        : `O Agent não pôde iniciar: ${err.message}`
    );
    app.exit(1);
  });
});

app.on('window-all-closed', e => e.preventDefault());
