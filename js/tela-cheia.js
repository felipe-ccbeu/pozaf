/* ============================================================================
   TELA CHEIA — fullscreen e atalhos de teclado
   Isolado porque nao depende de nada do WebRTC nem do estado da sala.
   ============================================================================ */

import { el, aviso, alternarHeader } from './ui.js';

/* requestFullscreen() e uma promise e SO funciona a partir de um gesto do
   usuario — por isso esta amarrado a um clique/tecla, nunca chamado sozinho.
   Usamos o <html> e nao o <video> de proposito: com a pagina inteira em
   fullscreen a barra continua acessivel por cima. Se puséssemos o <video>,
   o navegador mostraria so o video e perderiamos os controles. */

export function emTelaCheia() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

export async function alternarTelaCheia() {
  try {
    if (emTelaCheia()) {
      await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
    } else {
      const alvo = document.documentElement;
      await (alvo.requestFullscreen?.() ?? alvo.webkitRequestFullscreen?.());
    }
  } catch (err) {
    /* Safari no iPhone não deixa nada além de <video> entrar em fullscreen. */
    console.warn('[ui] fullscreen negado:', err);
    aviso('Seu navegador não permitiu tela cheia nesta página. '
        + 'No iPhone, use o botão de tela cheia do próprio player de vídeo.');
  }
}

/* O evento cobre também o caso de sair pelo Esc, que não passa pelo botão. */
document.addEventListener('fullscreenchange', () => {
  el.txtFull.textContent = emTelaCheia() ? 'Sair da tela cheia' : 'Tela cheia';
});

el.btnFull.addEventListener('click', alternarTelaCheia);

/* Atalhos: F alterna tela cheia, H alterna o header.
   Ignorados enquanto o foco estiver num campo de texto, senão digitar o
   nome de uma sala viraria atalho. */
document.addEventListener('keydown', (e) => {
  const alvo = e.target;
  const digitando = alvo instanceof HTMLInputElement
                 || alvo instanceof HTMLSelectElement
                 || alvo instanceof HTMLTextAreaElement;
  if (digitando || e.ctrlKey || e.metaKey || e.altKey) return;

  const tecla = e.key.toLowerCase();
  if (tecla === 'f') { e.preventDefault(); alternarTelaCheia(); }
  if (tecla === 'h') { e.preventDefault(); alternarHeader(); }
});
