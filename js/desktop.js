/* ============================================================================
   DESKTOP — o que so acontece quando rodamos dentro do app Electron
   ============================================================================

   No navegador este arquivo carrega e nao faz absolutamente nada: tudo aqui
   esta atras do teste `if (!window.pozaf)`. E de proposito — a mesma pasta
   continua funcionando no GitHub Pages sem nenhuma alteracao.

   Duas coisas mudam no app:

     1. A JANELA nao tem moldura, entao precisamos devolver o arrastar e os
        botoes de minimizar / maximizar / fechar.

     2. O LINK DA SALA nao pode usar location.origin, que no app e file://.
        Um link file:// nao abre na maquina de ninguem. Por isso perguntamos
        ao processo principal qual e a URL publica do site.
   ============================================================================ */

'use strict';

/* Guardamos a URL publica assim que o app responde. host.js le isso pela
   funcao baseDoLink() abaixo. */
let urlPublica = null;

/** true quando rodando dentro do app; false no navegador. */
export const noDesktop = Boolean(window.pozaf?.desktop);

/**
 * Base para montar o link da sala.
 * No navegador: o proprio endereco da pagina, como sempre foi.
 * No app: a URL publica configurada em desktop/config.json.
 */
export function baseDoLink() {
  if (noDesktop && urlPublica) return urlPublica;
  return `${location.origin}${location.pathname}`;
}

if (noDesktop) {
  /* ---- 1. Pegar a URL publica logo no inicio --------------------------
     Buscamos ANTES de qualquer transmissao comecar, para que ela ja esteja
     na memoria quando o host precisar montar o link. */
  window.pozaf.urlPublica().then((url) => {
    urlPublica = url;
    if (!url || url.includes('SEU-USUARIO')) {
      avisarUrlNaoConfigurada();
    }
  }).catch((e) => {
    /* Sem catch, uma falha aqui viraria uma promise rejeitada silenciosa e
       urlPublica ficaria null para sempre — o host montaria um link file://
       sem ninguem entender por que. */
    console.error('[desktop] nao consegui ler a URL publica:', e);
    avisarUrlNaoConfigurada();
  });

  /* O aviso amarelo do proprio app, o mesmo usado para "sem audio". Aparece
     ANTES de a pessoa transmitir e descobrir que o link nao presta. */
  function avisarUrlNaoConfigurada() {
    const caixa = document.getElementById('aviso');
    if (!caixa) return;
    caixa.textContent =
      'O endereco publico do site ainda nao foi configurado. O link da sala '
    + 'nao vai funcionar para seus amigos ate voce editar "urlPublica" em '
    + 'desktop/config.json.';
    caixa.hidden = false;
  }

  /* ---- 2. Devolver os controles da janela -----------------------------
     A moldura sumiu (frame:false no main.js), entao desenhamos os tres
     botoes nos e penduramos no canto direito da barra. Criamos por
     JavaScript, e nao no index.html, justamente para que o site no
     navegador nao ganhe botoes de janela que nao fariam sentido la. */
  document.documentElement.classList.add('no-desktop');

  const criarBotoes = () => {
    const painel = document.getElementById('painel');
    if (!painel) return;

    const caixa = document.createElement('div');
    caixa.className = 'controles-janela';

    /* Os tres glifos sao os mesmos do Windows: traco, quadrado, X. */
    const botoes = [
      { acao: 'minimizar', titulo: 'Minimizar', svg: '<path d="M3 8h10"/>' },
      { acao: 'maximizar', titulo: 'Maximizar', svg: '<rect x="3.5" y="3.5" width="9" height="9"/>' },
      { acao: 'fechar',    titulo: 'Fechar',    svg: '<path d="M4 4l8 8M12 4l-8 8"/>' },
    ];

    for (const b of botoes) {
      const btn = document.createElement('button');
      btn.className = 'btn-janela' + (b.acao === 'fechar' ? ' fechar' : '');
      btn.title = b.titulo;
      btn.setAttribute('aria-label', b.titulo);
      btn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"
        fill="none" stroke="currentColor" stroke-width="1.3"
        aria-hidden="true">${b.svg}</svg>`;
      btn.addEventListener('click', () => window.pozaf[b.acao]());
      caixa.appendChild(btn);
    }

    painel.appendChild(caixa);
  };

  criarBotoes();

  /* ---- 3. Atalhos que o navegador dava de graca ------------------------
     Sem moldura e sem menu, F11 e Alt+F4 param de existir. Devolvemos so o
     essencial: Esc nao fecha (seria facil demais fechar sem querer no meio
     de uma transmissao), mas Ctrl+W sim, que e o reflexo de todo mundo. */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      window.pozaf.fechar();
    }
  });
}
