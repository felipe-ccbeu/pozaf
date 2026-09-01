/* ============================================================================
   MAIN — o processo principal do Electron
   ============================================================================

   Este arquivo NAO roda no navegador: ele roda no Node, e e ele quem cria a
   janela. Nada de DOM aqui. A pagina (index.html, css/, js/) continua sendo
   exatamente a mesma que roda no GitHub Pages — nao mexemos nela para o app
   funcionar, exceto pelos dois detalhes explicados mais abaixo.

   ONDE MEXER EM CADA COISA:
     LARGURA/ALTURA inicial ....... criarJanela(), no objeto BrowserWindow
     URL publica do site .......... desktop/config.json (gerado no 1o start)
     Botoes minimizar/fechar ...... ipcMain.on('janela:...'), no fim
   ============================================================================ */

'use strict';

const { app, BrowserWindow, ipcMain, desktopCapturer, session, shell } =
  require('electron');
const path = require('path');
const fs   = require('fs');

/* ----------------------------------------------------------------------------
   A URL PUBLICA — o detalhe mais importante deste arquivo.

   No navegador, o host monta o link da sala com location.origin, que da algo
   como https://usuario.github.io/pozaf/#sala=xxx. No app, location.origin e
   file://, e um link file:// nao abre na maquina de ninguem.

   Entao o app precisa saber qual e o endereco publico do site para montar o
   link que voce manda pros amigos. Ele fica em desktop/config.json, criado
   automaticamente na primeira execucao para voce editar.
   -------------------------------------------------------------------------- */
const ARQ_CONFIG = path.join(__dirname, 'config.json');

const CONFIG_PADRAO = {
  urlPublica: 'https://SEU-USUARIO.github.io/pozaf/',
};

function lerConfig() {
  try {
    if (!fs.existsSync(ARQ_CONFIG)) {
      fs.writeFileSync(ARQ_CONFIG, JSON.stringify(CONFIG_PADRAO, null, 2));
      return CONFIG_PADRAO;
    }
    return { ...CONFIG_PADRAO, ...JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8')) };
  } catch (e) {
    console.warn('[main] config.json ilegivel, usando o padrao:', e.message);
    return CONFIG_PADRAO;
  }
}

let janela = null;

function criarJanela() {
  janela = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  900,
    minHeight: 560,

    /* Sem a moldura do Windows — era esse o pedido. A barra de titulo, os
       botoes de minimizar/fechar e a borda somem; sobra so o conteudo.
       Em troca, a janela perde o "arrastar pela barra": quem devolve isso e
       o -webkit-app-region:drag no CSS (ver css/desktop.css). */
    frame: false,

    /* Preto puro desde o primeiro frame. Sem isso o Electron pinta branco
       enquanto carrega e voce ve um flash claro na abertura. */
    backgroundColor: '#000000',

    /* Nao mostrar a janela ainda: esperamos o ready-to-show. Evita ver a
       pagina montando. */
    show: false,

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),

      /* A pagina e nossa e nao roda codigo de terceiros alem do PeerJS, mas
         mantemos o isolamento ligado mesmo assim: o preload expoe so as tres
         funcoes de janela, e nada de Node vaza para o front. */
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  janela.once('ready-to-show', () => janela.show());
  janela.loadFile(path.join(__dirname, '..', 'index.html'));

  /* Links externos (o "abrir no navegador") vao para o navegador padrao em
     vez de sequestrar a janela do app. */
  janela.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  /* Avisa a pagina quando maximiza/restaura, para o botao trocar de icone. */
  janela.on('maximize',   () => janela.webContents.send('janela:estado', true));
  janela.on('unmaximize', () => janela.webContents.send('janela:estado', false));
}

/* ----------------------------------------------------------------------------
   O SELETOR DE TELA

   No navegador, getDisplayMedia abre sozinho aquela janela de "compartilhar
   aba / janela / tela". No Electron ela NAO existe: sem o handler abaixo, a
   chamada rejeita na hora e o app parece quebrado.

   setDisplayMediaRequestHandler recebe o pedido e responde qual fonte usar.
   Usamos { useSystemPicker: true } para pedir o seletor NATIVO do Windows —
   o mesmo que o Teams e o Discord usam. Quando o sistema nao o oferece
   (Windows mais antigo), caimos na tela inteira, que e o caso de uso comum
   aqui e evita deixar o usuario sem nada.
   -------------------------------------------------------------------------- */
function registrarSeletorDeTela() {
  session.defaultSession.setDisplayMediaRequestHandler(async (req, callback) => {
    try {
      const fontes = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      if (!fontes.length) return callback({});      // {} = negado, a pagina trata
      callback({ video: fontes[0], audio: 'loopback' });
    } catch (e) {
      console.error('[main] falha ao listar telas:', e);
      callback({});
    }
  }, { useSystemPicker: true });
}

app.whenReady().then(() => {
  registrarSeletorDeTela();
  criarJanela();

  /* No macOS o app fica vivo sem janela; clicar no dock reabre. */
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

/* No Windows/Linux, fechar a janela e fechar o app. */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ----------------------------------------------------------------------------
   PONTE COM A PAGINA
   Tudo que a pagina pode pedir ao processo principal passa por aqui. A lista
   e curta de proposito.
   -------------------------------------------------------------------------- */
ipcMain.handle('app:url-publica', () => lerConfig().urlPublica);

ipcMain.on('janela:minimizar', () => janela?.minimize());
ipcMain.on('janela:maximizar', () => {
  if (!janela) return;
  janela.isMaximized() ? janela.unmaximize() : janela.maximize();
});
ipcMain.on('janela:fechar', () => janela?.close());
