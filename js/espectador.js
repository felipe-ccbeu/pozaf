/* ============================================================================
   ESPECTADOR — entra na sala e so recebe
   Transmissao de mao unica: answer() SEM argumento, para o navegador nao
   pedir camera nem microfone de quem esta assistindo.
   ============================================================================ */

import { CONFIG, montarIceServers } from './config.js';
import { el, status, aviso, mostrarVideo,
         textoBotao, liberarHeader, prenderHeader } from './ui.js';

let peer = null;

/* Preenchido pelo app.js com o id lido do #sala= da URL. */
let salaAlvo = null;
export function definirSala(id) { salaAlvo = id; }

export async function entrarNaSala() {
  el.btn.disabled = true;
  aviso('');
  status('Conectando ao servidor de sinalização…');

  const iceServers = await montarIceServers();

  /* Sem id: o broker sorteia um pra gente. O espectador não precisa de um id
     bonito, ninguém vai discar pra ele além do host. */
  peer = new Peer({ config: { iceServers }, debug: 1 });

  peer.on('open', () => {
    status('Procurando a sala…');

    /* Canal de DADOS. Não mandamos nada por ele — ele existe só para o host
       descobrir o nosso id e poder nos ligar de volta com o vídeo. */
    const conn = peer.connect(salaAlvo);

    conn.on('open', () => {
      status('Na sala. Esperando o vídeo do host…');
      armarVigia();   // se o vídeo não chegar, é quase sempre NAT
    });

    conn.on('close', () => {
      status('O host encerrou a transmissão.', 'erro');
      el.vazio.textContent = 'O host encerrou a transmissão.';
    });
  });

  /* --- "call": o host está nos ligando com a mídia ---------------------- */
  peer.on('call', (chamada) => {

    /* answer() SEM ARGUMENTO = transmissão de mão única. Estamos dizendo
       "aceito receber, mas não mando nada de volta". Se passássemos um
       stream aqui, o navegador pediria câmera/microfone do espectador —
       que é exatamente o que não queremos. */
    chamada.answer();

    chamada.on('stream', (remoto) => {
      /* Sem muted aqui, de propósito: o espectador PRECISA ouvir. E pode,
         porque tudo isso começou com um clique dele no botão. */
      el.video.muted = false;
      el.video.srcObject = remoto;
      mostrarVideo();
      desarmarVigia();
      status('Recebendo.', 'ok');
      liberarHeader();   // some pra dar espaco ao video

      /* Alguns navegadores ainda engasgam no autoplay. Se acontecer, pelo
         menos deixamos rodar mudo em vez de mostrar tela preta. */
      el.video.play().catch(() => {
        el.video.muted = true;
        el.video.play();
        aviso('O navegador bloqueou o som. O vídeo está rodando mudo — '
            + 'clique no ícone de volume do player para liberar.');
      });
    });

    chamada.on('close', () => {
      status('Transmissão encerrada pelo host.');
      prenderHeader();
      el.video.srcObject = null;
      el.video.hidden = true;
      el.vazio.hidden = false;
      el.vazio.textContent = 'Transmissão encerrada.';
    });
  });

  /* --- erros do lado do espectador -------------------------------------- */
  peer.on('error', (err) => {
    console.error('[espectador] erro:', err.type, err);
    desarmarVigia();
    prenderHeader();   // erro tem que ficar visivel
    el.btn.disabled    = false;
    textoBotao('Tentar de novo');

    if (err.type === 'peer-unavailable') {
      status('Sala não encontrada — o host já abriu a dele? '
           + 'Peça para ele conferir se ainda está compartilhando, ou mandar '
           + 'um link novo (o id muda a cada sessão).', 'erro');
    } else if (err.type === 'network' || err.type === 'server-error') {
      status('Não consegui falar com o servidor de sinalização. '
           + 'Confira sua internet e tente de novo.', 'erro');
    } else {
      status('Erro: ' + err.type, 'erro');
    }

    /* Rearma o botão para uma nova tentativa. */
    el.btn.addEventListener('click', () => location.reload(), { once: true });
  });
}

/* ---- vigia de NAT ---------------------------------------------------------
   Este é o sintoma mais cruel do WebRTC: a sinalização funciona, o canal de
   dados abre, tudo parece certo — e o vídeo simplesmente nunca chega, sem
   erro nenhum. Quase sempre é NAT restritivo dos dois lados, e a solução é
   TURN. Como o WebRTC não avisa, avisamos nós. */
let vigia = null;

function armarVigia() {
  desarmarVigia();
  vigia = setTimeout(() => {
    const temTurn = CONFIG.METERED_API_KEY && CONFIG.METERED_SUBDOMINIO;
    aviso('O vídeo não chegou em ' + CONFIG.SEGUNDOS_ATE_DESISTIR + 's. '
        + 'Isso quase sempre é a sua rede (CGNAT da operadora, wi-fi '
        + 'corporativo ou 4G) bloqueando a conexão direta. '
        + (temTurn
            ? 'O TURN está configurado — tente recarregar a página.'
            : 'A solução é ligar um servidor TURN: veja o bloco CONFIG no '
            + 'topo do app.js.'));
  }, CONFIG.SEGUNDOS_ATE_DESISTIR * 1000);
}

function desarmarVigia() {
  if (vigia) { clearTimeout(vigia); vigia = null; }
}

/* Usado pela limpeza ao fechar a aba (ver app.js). */
export function derrubarEspectador() {
  if (peer && !peer.destroyed) peer.destroy();
}

