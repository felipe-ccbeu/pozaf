/* ============================================================================
   APP — ponto de entrada
   ============================================================================

   Este arquivo é curto de propósito: ele só decide QUEM somos (host ou
   espectador) e liga os fios. A lógica de verdade mora nos outros módulos.

   ONDE MEXER EM CADA COISA:
     config.js      TURN, STUN, qualidade — a configuração
     ui.js          status, avisos, a barra que recolhe — o visual
     tela-cheia.js  fullscreen e os atalhos F / H
     host.js        capturar a tela e transmitir
     espectador.js  entrar na sala e receber

   COMO O WEBRTC FUNCIONA, EM 30 SEGUNDOS

   WebRTC permite que dois navegadores mandem vídeo DIRETO um pro outro, sem
   servidor no meio. Mas eles precisam se achar primeiro — e você não sabe o
   IP do seu amigo. Quem faz essa apresentação é o "servidor de sinalização"
   (aqui: o broker público e gratuito do PeerJS).

   O broker só troca envelopes de texto no começo. Depois que o túnel abre,
   ele SAI DE CENA. O vídeo nunca passa por ele — nem por ele, nem pelo
   GitHub. É direto, e criptografado (DTLS/SRTP).
   ============================================================================ */

'use strict';

import { el, status, prenderHeader }        from './ui.js';
import { iniciarHost, encerrarHost,
         derrubarHost }                     from './host.js';
import { entrarNaSala, definirSala,
         derrubarEspectador }               from './espectador.js';

/* tela-cheia.js não exporta nada que usemos aqui: importamos pelo efeito
   colateral de registrar o botão e os atalhos de teclado. */
import './tela-cheia.js';

/* ============================================================================
   ROTEAMENTO — a mesma página, dois modos

   Decidimos pelo HASH da URL (o pedaço depois do #), e não por query string,
   de propósito: o navegador NUNCA envia o hash ao servidor. Então o GitHub
   Pages jamais vê o id das suas salas nos logs dele.

   (Ressalva honesta: o broker do PeerJS obviamente VÊ o id da sala — é ele
   que faz o encontro. O que ninguém vê, em nenhuma hipótese, é o conteúdo
   da sua tela: isso vai direto e criptografado.)
   ============================================================================ */

/** Devolve o id do host se a URL tiver #sala=xxx, senão null. */
function lerSalaDaUrl() {
  const m = location.hash.match(/^#sala=(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

const salaAlvo = lerSalaDaUrl();

if (salaAlvo) {
  /* ------------------------------------------------ MODO ESPECTADOR */
  definirSala(salaAlvo);

  el.modo.textContent = 'espectador';
  el.btn.querySelector('span').textContent = 'Entrar na sala';
  el.btn.disabled = false;
  status('Pronto. Clique em "Entrar na sala".');

  /* O clique é OBRIGATÓRIO, não é preguiça de UI: o stream vem com áudio, e
     todo navegador bloqueia autoplay com som sem um gesto do usuário. Se
     tentássemos conectar sozinhos no load, o vídeo chegaria e ficaria
     congelado no primeiro quadro, mudo. */
  el.btn.addEventListener('click', entrarNaSala, { once: true });

} else {
  /* ------------------------------------------------------ MODO HOST */
  el.modo.textContent = 'host';
  el.btn.querySelector('span').textContent = 'Compartilhar minha tela';
  el.btn.disabled     = false;
  el.qualidade.hidden = false;
  status('Pronto. Escolha a qualidade e clique para compartilhar.');

  el.btn.addEventListener('click', iniciarHost);
  el.btnParar.addEventListener('click', encerrarHost);
}

prenderHeader();   // barra começa aberta

/* ============================================================================
   LIMPEZA AO FECHAR A ABA
   Sem isso, o host some sem avisar e os espectadores ficam olhando um vídeo
   congelado por um bom tempo até o WebRTC perceber sozinho.
   ============================================================================ */
window.addEventListener('pagehide', () => {
  derrubarHost();
  derrubarEspectador();
});
