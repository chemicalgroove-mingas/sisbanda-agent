'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path   = require('path');
const os     = require('os');
const logger = require('./services/logger');
const { startServer }        = require('./server');
const { loadConfig }         = require('./config');
const { verificarAtualizacao, getUpdateInfo } = require('./services/updater');

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const LOG_DIR   = path.join(os.homedir(), 'AppData', 'Roaming', 'SisbandaAgent', 'logs');
const PORT      = loadConfig().port;
const VERSION   = loadConfig().agentVersion;

let win  = null;
let tray = null;

// ── Janela principal ────────────────────────────────────────────────────────
function criarJanela() {
  win = new BrowserWindow({
    width:  460,
    height: 560,
    resizable: false,
    title: 'SISBANDA Agent',
    icon:  ICON_PATH,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    show: false,
  });

  win.loadURL(`http://localhost:${PORT}/ui`);
  win.setMenuBarVisibility(false);

  win.once('ready-to-show', () => win.show());

  // Fechar minimiza para bandeja, não encerra
  win.on('close', e => {
    e.preventDefault();
    win.hide();
  });
}

// ── Bandeja do sistema ──────────────────────────────────────────────────────
function criarTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(`SISBANDA Agent v${VERSION}`);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Abrir',
      click: () => { win.show(); win.focus(); },
    },
    {
      label: 'Ver Logs',
      click: () => shell.openPath(LOG_DIR),
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
  tray.on('double-click', () => { win.show(); win.focus(); });
}

// ── Inicialização ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Evita múltiplas instâncias
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }

  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

  startServer(() => {
    logger.info('Servidor HTTP + WebSocket iniciados.');
    // Verifica atualização 5 s após start (não bloqueia inicialização)
    setTimeout(() => verificarAtualizacao().then(u => {
      if (u?.available) logger.info(`Atualização disponível: ${u.version}`);
    }), 5000);
  });

  criarJanela();
  criarTray();
});

app.on('window-all-closed', e => e.preventDefault());
