// Electron 메인 프로세스 — 자비스 데스크톱 래퍼 (패턴 A: dev 서버 동시 띄우기)
// 전제: 별도 터미널에서 `pnpm dev` (Next dev 서버)가 localhost:3000 으로 떠 있어야 함.
// 본 프로세스는 BrowserWindow 만 띄워서 그 URL 을 로드한다.

const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// .env.local 단순 로더 — Next dev 서버 는 자체 로드하지만 Electron 메인 프로세스는 별도.
// dotenv 의존성 추가 회피용 최소 파서. 박힌 키만 process.env 에 박음.
function loadEnvFromFile(envFilePath) {
  try {
    const content = fs.readFileSync(envFilePath, 'utf8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex < 0) return;
      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    });
  } catch (loadError) {
    console.warn(`[jarvis] env file not loaded (${envFilePath}):`, loadError.message);
  }
}
loadEnvFromFile(path.join(__dirname, '..', '.env.local'));

const DEV_SERVER_URL = process.env.JARVIS_DEV_URL || 'http://localhost:3000';
const TOGGLE_ACCELERATOR = 'CommandOrControl+Shift+Space';
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray-iconTemplate.png');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

let mainWindow = null;
let tray = null;
let isQuitting = false;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    // JarvisConsole 시안 박스가 1100×740 고정. 창은 여유 + p-10(40px) 패딩 고려해서 1280×900.
    // minWidth/Height 도 박스가 안 잘리는 최소치로.
    width: 1280,
    height: 900,
    minWidth: 1180,
    minHeight: 820,
    title: 'Jarvis',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD_PATH,
    },
  });

  // dev 서버가 늦게 뜨는 경우 대비: 실패 시 1.5초 후 재시도
  function loadWithRetry() {
    mainWindow.loadURL(DEV_SERVER_URL).catch((loadError) => {
      console.warn('[jarvis] loadURL failed, retrying in 1500ms:', loadError.message);
      setTimeout(loadWithRetry, 1500);
    });
  }
  loadWithRetry();

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.warn(`[jarvis] did-fail-load (${errorCode}): ${errorDescription}. Retrying in 1500ms.`);
    setTimeout(loadWithRetry, 1500);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 토글 모델: 빨간 X 눌러도 destroy 하지 않고 hide. 정상 종료(Cmd+Q, before-quit) 시에만 통과.
  mainWindow.on('close', (closeEvent) => {
    if (!isQuitting) {
      closeEvent.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  const trayImage = nativeImage.createFromPath(TRAY_ICON_PATH);
  // 안전망: 위 PNG 가 비어 있어도 Tray 생성 자체는 실패 안 함. 빈 아이콘은 시각적으로만 안 보임.
  tray = new Tray(trayImage);
  tray.setToolTip('Jarvis (⌘⇧Space)');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '열기 / 숨기기',
      accelerator: TOGGLE_ACCELERATOR,
      click: toggleMainWindow,
    },
    { type: 'separator' },
    {
      label: '종료',
      accelerator: 'CommandOrControl+Q',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  // macOS 컨벤션: 좌클릭은 토글, 우클릭은 메뉴
  tray.on('click', toggleMainWindow);
  tray.on('right-click', () => {
    tray.popUpContextMenu(contextMenu);
  });
}

function registerToggleShortcut() {
  const registered = globalShortcut.register(TOGGLE_ACCELERATOR, toggleMainWindow);
  if (!registered) {
    console.warn(
      `[jarvis] Failed to register ${TOGGLE_ACCELERATOR} — already in use by another app (Raycast/Alfred?).`
    );
  } else {
    console.log(`[jarvis] Registered global shortcut ${TOGGLE_ACCELERATOR}`);
  }
}

app.whenReady().then(() => {
  // 메뉴바 상주(LSUIElement) 모델: dock 아이콘 숨기고 tray 만 진입로로 둠.
  // 끄고 싶으면 환경변수 JARVIS_KEEP_DOCK=1.
  if (process.platform === 'darwin' && app.dock && !process.env.JARVIS_KEEP_DOCK) {
    app.dock.hide();
  }

  // Block 26 — Whisper STT 위해 마이크 권한 자동 허용.
  // 'media' 권한은 navigator.mediaDevices.getUserMedia 호출 시 발동. callback(true) 박으면
  // Electron 단에서는 허용, 그 후 macOS 시스템 모달이 첫 1회 사용자 확인 받음.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(false);
  });

  // Block 28 — 인용 칩 클릭 → Obsidian 페이지 열기.
  // renderer 가 ipcRenderer.invoke('open-wiki-page', relativePath) 호출 → 메인이 URI 생성 + shell.openExternal.
  // OBSIDIAN_VAULT_NAME env 박혀 있어야 함. 없으면 에러 반환 (renderer 에서 console.warn).
  ipcMain.handle('open-wiki-page', async (_event, relativePath) => {
    const vaultName = process.env.OBSIDIAN_VAULT_NAME;
    if (!vaultName) {
      return { ok: false, error: 'OBSIDIAN_VAULT_NAME 환경변수 미설정' };
    }
    if (!relativePath || typeof relativePath !== 'string') {
      return { ok: false, error: 'invalid path' };
    }
    // Obsidian URI 는 vault 이름 + vault root 기준 file path (확장자 옵션).
    // lib/wiki.ts 가 박은 path = wiki root 기준 (vault root 와 동일 가정 — README 에 명시).
    const obsidianUri =
      `obsidian://open?vault=${encodeURIComponent(vaultName)}` +
      `&file=${encodeURIComponent(relativePath)}`;
    try {
      await shell.openExternal(obsidianUri);
      return { ok: true };
    } catch (openError) {
      return { ok: false, error: openError.message };
    }
  });

  createMainWindow();
  createTray();
  registerToggleShortcut();

  app.on('activate', () => {
    // macOS: dock 숨김 모드여도 tray 클릭/단축키로 다시 띄울 수 있음.
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // 토글 모델에선 close 가 hide 로 가로채져 사실상 발생 안 함.
  // 안전망: 비-macOS 환경에서만 종료.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
