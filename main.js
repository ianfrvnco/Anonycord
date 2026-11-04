const { app, BrowserWindow, desktopCapturer, session, ipcMain } = require('electron');
// require('./server.js'); // Desativado pois o servidor está hospedado no Render

let mainWindow;

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1200, 
    height: 800,
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false 
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 300, height: 200 } }).then((sources) => {
      const formattedSources = sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL()
      }));

      mainWindow.webContents.send('open-screen-picker', formattedSources);

      ipcMain.once('select-screen-source', (event, selectedId) => {
        if (!selectedId) {
          callback({});
          return;
        }
        const selectedSource = sources.find(s => s.id === selectedId);
        if (selectedSource) {
          callback({ video: selectedSource, audio: 'loopback' });
        } else {
          callback({});
        }
      });
    });
  });

  createWindow();
});

app.on('window-all-closed', () => { 
  if (process.platform !== 'darwin') app.quit(); 
});