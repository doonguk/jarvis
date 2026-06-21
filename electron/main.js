// Electron 메인 프로세스 — 자비스 데스크톱 래퍼 (패턴 A: dev 서버 동시 띄우기)
// 전제: 별도 터미널에서 `pnpm dev` (Next dev 서버)가 localhost:3000 으로 떠 있어야 함.
// 본 프로세스는 BrowserWindow 만 띄워서 그 URL 을 로드한다.

const { app, BrowserWindow } = require('electron');
const path = require('path');

const DEV_SERVER_URL = process.env.JARVIS_DEV_URL || 'http://localhost:3000';

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 640,
    minHeight: 480,
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    // macOS: dock 아이콘 클릭 시 창 없으면 새로 띄움
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Block 21 단순 패턴: 창 닫히면 종료. Block 22 에서 단축키 토글 모델로 변경 예정.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
