'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, session, shell, net, webContents } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
if (process.env.APP_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.APP_USER_DATA_DIR));
}
app.setName('3AM Diary Studio');
if (process.env.APP_DATA_DIR) {
  // Data isolation for automated tests.
} else {
  process.env.APP_DATA_DIR = path.join(app.getPath('userData'), 'data');
}
const DATA_DIR = path.resolve(process.env.APP_DATA_DIR);
const MUSE_RULE_FILE = path.resolve(process.env.MUSE_RULE_FILE || path.join(ROOT, 'config', 'muse_rule.json'));
fs.mkdirSync(DATA_DIR, { recursive: true });

const { LocalServer } = require('./server');
const { Library } = require('./library');
const { Workspace } = require('./workspace');
const { JobQueue } = require('./jobs');
const { MuseRuleSlot } = require('./museRule');
const { MuseGate, MUSE_PARTITION } = require('./muse');
const { MuseLoginService } = require('./museLogin');
const { INSPECT_SELECTORS_SCRIPT } = require('./museInspect');
const { DemoService } = require('./demo');
const {
  scrapeThreads,
  threadsLoginState,
  openThreadsLoginWindow,
  CHROME_UA,
} = require('./threads/scraper');
const { discoverThreads } = require('./threads/discoverThreads');

let mainWindow = null;
let server = null;
let museLoginService = null;
const openMuseLoginOnReady = process.argv.includes('--muse-login');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !process.env.E2E_TEST) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    if (Array.isArray(argv) && argv.includes('--muse-login') && museLoginService) {
      try {
        museLoginService.open();
      } catch (error) {
        console.error('[muse-login]', error.message);
      }
    }
  });
}

app.setAppUserModelId('com.3amdiary.studio');

app.whenReady().then(async () => {
  try {
    const museRule = new MuseRuleSlot(MUSE_RULE_FILE);
    const museGate = new MuseGate(museRule);
    const museLogin = new MuseLoginService({ ruleSlot: museRule, getParentWindow: () => mainWindow });
    museLoginService = museLogin;
    const library = new Library(DATA_DIR);
    const workspace = new Workspace(DATA_DIR);
    const jobs = new JobQueue({ dataDir: DATA_DIR, library });
    const demo = new DemoService({ rootDir: ROOT, library, workspace });

    try {
      const museSes = session.fromPartition(MUSE_PARTITION);
      museSes.setUserAgent(CHROME_UA, 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7');
    } catch {}

    server = new LocalServer({
      rootDir: ROOT,
      dataDir: DATA_DIR,
      library,
      workspace,
      jobs,
      muse: museGate,
      ruleSlot: museRule,
      demo,
      scrapeThreads: (url, options = {}) => scrapeThreads(url, { ...options, debugDump: process.env.SCRAPER_DUMP_DIR || '' }),
      discoverThreads: (options = {}) => discoverThreads({ ...options, debugDump: process.env.SCRAPER_DUMP_DIR || '' }),
      threadsLoginState,
      openThreadsLoginWindow: () => openThreadsLoginWindow(mainWindow),
      openMuseLoginWindow: () => museLogin.open(),
      measureMuseSession: () => museLogin.measure(),
      inspectMusePage: async () => {
        try {
          return await museLogin.inspectSelectors();
        } catch (error) {
          if (error.code !== 'MUSE_LOGIN_WINDOW_NOT_OPEN') throw error;
          const contents = museGate.findWebview();
          if (!contents) throw error;
          const result = await contents.executeJavaScript(INSPECT_SELECTORS_SCRIPT, true);
          return {
            ok: true,
            url: contents.getURL(),
            title: contents.getTitle(),
            groups: result?.groups || { inputs: [], sendButtons: [], responses: [], loginHints: [] },
            inspectedAt: new Date().toISOString(),
          };
        }
      },
      isOnline: () => {
        if (process.env.E2E_TEST) return true;
        try {
          return net.isOnline();
        } catch {
          return true;
        }
      },
      quit: () => app.quit(),
      openDataFolder: () => shell.openPath(DATA_DIR),
      getAppInfo: () => ({
        name: '3AM Diary Studio',
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        data_dir: DATA_DIR,
        platform: process.platform,
        phase: 'frontend',
        target: { width: 576, height: 1024, fps: 30, duration_min: 60, duration_max: 90 },
      }),
    });

    await server.start();
    await jobs.load();

    mainWindow = new BrowserWindow({
      width: 1480,
      height: 940,
      minWidth: 1180,
      minHeight: 720,
      show: false,
      backgroundColor: '#070b14',
      title: '3AM Diary Studio',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        spellcheck: false,
      },
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(server.url());
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      if (process.env.DEBUG_DEVTOOLS) mainWindow.webContents.openDevTools({ mode: 'detach' });
      if (openMuseLoginOnReady) {
        try {
          museLogin.open();
        } catch (error) {
          console.error('[muse-login]', error.message);
        }
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
      const partition = params.partition || webPreferences.partition;
      let originOk = false;
      try {
        originOk = new URL(params.src).origin === museRule.allowedOrigin();
      } catch {}
      if (partition !== MUSE_PARTITION || !museRule.isConfigured() || !originOk) {
        event.preventDefault();
        return;
      }
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
      params.allowpopups = '';
    });

    app.on('web-contents-created', (_event, contents) => {
      if (contents.getType() !== 'webview') return;
      contents.setWindowOpenHandler(({ url }) => {
        if (!/^https:\/\//i.test(url)) return { action: 'deny' };
        try {
          const popup = new BrowserWindow({
            width: 1040,
            height: 780,
            parent: mainWindow || undefined,
            backgroundColor: '#0b1020',
            autoHideMenuBar: true,
            webPreferences: {
              partition: MUSE_PARTITION,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          });
          popup.loadURL(url);
        } catch {}
        return { action: 'deny' };
      });
      contents.on('will-navigate', (event, url) => {
        if (!/^https:\/\//i.test(url) && !/^http:\/\/127\.0\.0\.1/.test(url)) event.preventDefault();
      });
    });

    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    ipcMain.handle('app:open-data', async () => {
      await shell.openPath(DATA_DIR);
      return { ok: true, dir: DATA_DIR };
    });
    ipcMain.on('app:quit', () => app.quit());

    if (process.env.E2E_TEST) {
      console.log('[e2e] app ready', JSON.stringify({ port: server.port, dataDir: DATA_DIR, url: server.url() }));
    }
  } catch (error) {
    console.error('[startup]', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (server) {
    server.stop().catch(() => {});
  }
});
