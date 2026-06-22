// Electron preload — renderer 에 안전하게 노출할 API 만 contextBridge 로.
// contextIsolation: true 박혀 있어서 renderer 는 require/electron API 직접 못 씀.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 위키 페이지 열기.
   * relativePath = lib/wiki.ts 가 박은 wiki root 기준 상대경로 (예: 'wiki/RAG-파이프라인.md').
   * 메인 프로세스가 Obsidian URI 로 변환해 shell.openExternal 호출.
   * 반환: Promise<{ ok: boolean, error?: string }>
   */
  openWikiPage: (relativePath) => ipcRenderer.invoke('open-wiki-page', relativePath),
});
