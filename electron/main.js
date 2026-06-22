// Electron 메인 프로세스 — 자비스 데스크톱 래퍼 (패턴 A: dev 서버 동시 띄우기)
// 전제: 별도 터미널에서 `pnpm dev` (Next dev 서버)가 localhost:3000 으로 떠 있어야 함.
// 본 프로세스는 BrowserWindow 만 띄워서 그 URL 을 로드한다.

const { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage } = require('electron');
const path = require('path');

const DEV_SERVER_URL = process.env.JARVIS_DEV_URL || 'http://localhost:3000';
const TOGGLE_ACCELERATOR = 'CommandOrControl+Shift+Space';
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray-iconTemplate.png');

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
