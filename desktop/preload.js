/* ============================================================================
   PRELOAD — a ponte entre o processo principal e a pagina
   ============================================================================

   Roda ANTES da pagina, com acesso ao Node, mas num mundo separado do
   JavaScript dela (contextIsolation). O unico jeito de os dois se falarem e
   pelo que expomos aqui, de proposito: assim a pagina ganha exatamente
   quatro poderes e nenhum a mais.

   Do outro lado, a pagina ve isso como window.pozaf — e o js/desktop.js
   checa a existencia dele para saber se esta no app ou no navegador.
   ============================================================================ */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pozaf', {

  /* Marca de agua: existe so no app. No navegador, window.pozaf e undefined,
     e todo o codigo de desktop simplesmente nao roda. */
  desktop: true,

  /* O endereco publico do site, para montar o link das salas. Assincrono
     porque a leitura do config.json acontece no processo principal. */
  urlPublica: () => ipcRenderer.invoke('app:url-publica'),

  /* Controles da janela, que sumiram junto com a moldura. */
  minimizar: () => ipcRenderer.send('janela:minimizar'),
  maximizar: () => ipcRenderer.send('janela:maximizar'),
  fechar:    () => ipcRenderer.send('janela:fechar'),

  /* Avisa quando a janela maximiza/restaura, para o botao trocar de icone. */
  aoMudarEstado: (fn) => {
    ipcRenderer.on('janela:estado', (_evento, maximizada) => fn(maximizada));
  },
});
