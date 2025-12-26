const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 400, // Increased to prevent layout squeezing (covers large phones/tablets)
    minHeight: 750, // Ensure all controls and some subtitle list are visible
    title: "AutoSub",
    // Set icon for window title bar and taskbar.
    // Use path.join to correctly locate the icon.
    // In production, resources are packed, but pointing to public/favicon.ico usually resolves correctly if included in files.
    icon: path.join(__dirname, 'public/favicon.ico'), 
    backgroundColor: '#0f172a',
    autoHideMenuBar: true, // 隐藏菜单栏
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false 
    }
  });

  // 开发环境加载 localhost，生产环境加载打包后的 index.html
  const isDev = !app.isPackaged;
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools(); // 开发时可开启调试工具
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // 拦截关闭事件，通知渲染进程显示自定义弹窗
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.webContents.send('app-close-request');
    }
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// 监听渲染进程的确认退出消息
ipcMain.on('app-close-confirm', () => {
  isQuitting = true;
  if (mainWindow) {
    mainWindow.close();
  }
});

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});