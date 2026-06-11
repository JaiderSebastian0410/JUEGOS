const { app, BrowserWindow, globalShortcut, screen } = require('electron');
const path = require('path');

// Disable hardware acceleration issues on some GPUs
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let mainWindow;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    fullscreen: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'icon-512.png'),
    backgroundColor: '#050510',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
    },
  });

  // Remove the menu bar entirely
  mainWindow.setMenu(null);

  // Load the game
  mainWindow.loadFile(path.join(__dirname, '..', 'juego.html'));

  // Show window when ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Register F11 to toggle fullscreen
  mainWindow.on('focus', () => {
    globalShortcut.register('F11', () => {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    });
    // ESC to exit fullscreen (not close)
    globalShortcut.register('Escape', () => {
      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
      }
    });
  });

  mainWindow.on('blur', () => {
    globalShortcut.unregisterAll();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
