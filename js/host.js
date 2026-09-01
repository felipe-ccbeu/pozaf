/* ============================================================================
   HOST — captura a tela e transmite para cada espectador
   Topologia mesh: uma conexao (e um encoder) SEPARADO por espectador.
   Otimo ate ~4 pessoas; acima disso o upload do host derrete.
   ============================================================================ */

import { montarIceServers } from './config.js';
import { el, status, aviso, mostrarVideo, palcoVazio, palcoCarregando,
         textoBotao, liberarHeader, prenderHeader } from './ui.js';
import { baseDoLink } from './desktop.js';

/* Estado local do host. Fica aqui, e nao num modulo compartilhado,
   porque ninguem de fora precisa mexer nisso. */
let peer   = null;   // a "linha telefonica" com o broker
let stream = null;   // a captura da tela

/* Chave = id do espectador, valor = { conn, chamada }.
   Guardamos as duas pontas para fechar tudo quando ele sair. */
const espectadores = new Map();

export async function iniciarHost() {
  el.btn.disabled = true;
  aviso('');

  /* ---- 5.1 Capturar a tela ---------------------------------------------
     getDisplayMedia abre aquela janela do navegador ("compartilhar aba /
     janela / tela inteira"). O try/catch NÃO é decorativo: se você fechar ou
     cancelar essa janela, a promise REJEITA com NotAllowedError. Sem catch,
     o app trava com o botão desabilitado pra sempre. */
  const largura = Number(el.selQual.value);
  try {
    status('Escolha o que compartilhar na janela do navegador…');
    palcoCarregando('Escolha o que compartilhar…');
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, width: { max: largura } },
      audio: true,
    });
  } catch (err) {
    el.btn.disabled = false;
    palcoVazio('Nada sendo exibido ainda.');
    if (err.name === 'NotAllowedError') {
      status('Você cancelou a seleção. Clique de novo quando quiser.', 'erro');
    } else if (err.name === 'NotFoundError') {
      status('Nenhuma tela disponível para capturar.', 'erro');
    } else {
      status('Não consegui capturar a tela: ' + err.message, 'erro');
    }
    console.error(err);
    return;
  }

  const trackVideo = stream.getVideoTracks()[0];

  /* Dica para o codificador: "esse conteúdo é texto/detalhe, priorize
     nitidez sobre fluidez". Faz diferença real para ler código na tela. */
  trackVideo.contentHint = 'detail';

  /* ---- 5.2 Áudio: checar de verdade se veio ----------------------------
     Pedir audio:true não garante nada. Firefox e Safari IGNORAM o pedido em
     silêncio — sem erro, sem aviso, simplesmente vem sem faixa de áudio. Só
     Chrome e Edge entregam. Então em vez de confiar, contamos as faixas. */
  if (stream.getAudioTracks().length === 0) {
    aviso('Sem áudio: seu navegador não capturou som da tela. Só Chrome e '
        + 'Edge fazem isso (e você precisa marcar "compartilhar áudio" na '
        + 'janela de seleção). O vídeo funciona normalmente.');
  }

  /* ---- 5.3 Prévia local ------------------------------------------------
     muted = true é obrigatório aqui. Sem isso, o áudio que você acabou de
     capturar sai pela sua própria caixa de som, é capturado de novo, e você
     ganha microfonia instantânea. */
  el.video.muted = true;
  el.video.srcObject = stream;
  mostrarVideo();

  /* ---- 5.4 Detectar o "parar de compartilhar" do navegador -------------
     O navegador mostra a própria barrinha de "parar compartilhamento". Ela
     não avisa o nosso código de forma nenhuma, exceto por este evento na
     faixa de vídeo. Sem escutar isso, você para de compartilhar e o app
     continua achando que está no ar. */
  trackVideo.addEventListener('ended', () => {
    status('Você parou o compartilhamento pela barra do navegador.');
    encerrarHost();
  });

  /* ---- 5.5 Abrir a linha telefônica ------------------------------------ */
  const iceServers = await montarIceServers();
  abrirPeerDoHost(iceServers);
}

/**
 * Cria o Peer do host com um id novo e aleatório e espera o "open".
 * Se o id sortear colisão com alguém no broker público, sorteamos outro.
 */
function abrirPeerDoHost(iceServers, tentativa = 1) {

  /* Id novo a cada sessão, de propósito: um link antigo nunca cai numa sala
     nova por acidente. ~2,8 trilhões de combinações, colisão é raríssima —
     mas o broker é público e compartilhado, então tratamos mesmo assim. */
  const idSala = 'tela-' + Math.random().toString(36).slice(2, 10);

  status('Conectando ao servidor de sinalização…');
  palcoCarregando('Abrindo a sala…');

  peer = new Peer(idSala, {
    config: { iceServers },   // <- vai direto para o RTCPeerConnection
    debug: 1,
  });

  /* --- "open": o broker aceitou nosso id. Só agora a sala existe. ------- */
  peer.on('open', (idConfirmado) => {
    /* baseDoLink() e location.origin no navegador, mas no app de desktop
       vira a URL publica do site: la, location.origin e file:// e o link
       nao abriria na maquina de ninguem. */
    const url = `${baseDoLink()}#sala=${idConfirmado}`;
    el.link.value      = url;
    el.areaLink.hidden = false;
    el.btnParar.hidden = false;
    el.contador.hidden = false;
    atualizarContador();
    status('No ar. Mande o link para seus amigos.', 'ok');
  });

  /* --- "connection": alguém tocou a campainha (canal de dados) ---------- */
  peer.on('connection', (conn) => {
    console.log('[host] espectador chegou:', conn.peer);

    /* ESPERAR o "open" da conn é essencial. O evento 'connection' dispara
       quando o pedido chega, mas o canal ainda está sendo negociado. Ligar
       de volta antes disso é chamar um telefone que ainda não tocou. */
    conn.on('open', () => {
      /* Aqui está o coração do mesh: um peer.call() SEPARADO por espectador,
         cada um com sua própria RTCPeerConnection e seu próprio encoder.
         Passamos o MESMO objeto stream — o navegador cuida de codificar de
         novo para cada destino. É por isso que o upload multiplica. */
      const chamada = peer.call(conn.peer, stream);

      espectadores.set(conn.peer, { conn, chamada });
      atualizarContador();
      status('Transmitindo.', 'ok');
      el.btn.classList.add('ativo');
      liberarHeader();   // some pra dar espaco ao video

      /* Limpeza: sem isso o contador só sobe e nunca desce. */
      chamada.on('close', () => removerEspectador(conn.peer));
      chamada.on('error', (e) => {
        console.warn('[host] erro na mídia com', conn.peer, e);
        removerEspectador(conn.peer);
      });
    });

    conn.on('close', () => removerEspectador(conn.peer));
  });

  /* --- erros do lado do host ------------------------------------------- */
  peer.on('error', (err) => {
    console.error('[host] erro:', err.type, err);

    if (err.type === 'unavailable-id' && tentativa < 4) {
      /* Colisão de id no broker público. Sorteia outro e tenta de novo. */
      peer.destroy();
      abrirPeerDoHost(iceServers, tentativa + 1);
      return;
    }
    if (err.type === 'network' || err.type === 'server-error') {
      status('Perdi contato com o servidor de sinalização. Quem já está '
           + 'assistindo continua (o vídeo é direto), mas ninguém novo '
           + 'consegue entrar.', 'erro');
      return;
    }
    status('Erro: ' + err.type, 'erro');
  });

  /* O broker às vezes derruba a conexão de sinalização por ociosidade.
     Reconectar mantém a sala aberta para novos espectadores. */
  peer.on('disconnected', () => {
    status('Reconectando ao servidor de sinalização…');
    if (peer && !peer.destroyed) peer.reconnect();
  });
}

function removerEspectador(id) {
  if (!espectadores.has(id)) return;
  espectadores.delete(id);
  atualizarContador();
  console.log('[host] espectador saiu:', id);
}

function atualizarContador() {
  const n = espectadores.size;
  el.contador.textContent = n === 1 ? '1 assistindo' : `${n} assistindo`;
}

/** Derruba tudo: mídia, conexões e o peer. Volta a página ao estado inicial. */
export function encerrarHost() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());   // apaga o ícone de captura
    stream = null;
  }
  if (peer && !peer.destroyed) peer.destroy();     // fecha todas as conexões
  peer = null;
  espectadores.clear();

  el.video.srcObject = null;
  palcoVazio('Compartilhamento encerrado.');
  el.areaLink.hidden = true;
  el.btnParar.hidden = true;
  el.contador.hidden = true;
  el.btn.disabled    = false;
  textoBotao('Compartilhar de novo');
  el.btn.classList.remove('ativo');
  prenderHeader();
  status('Encerrado. O link antigo não vale mais.');
}

/* ---- copiar o link --------------------------------------------------------
   navigator.clipboard exige contexto seguro (HTTPS ou localhost). Em file://
   ele nem existe — por isso o fallback de selecionar o texto. */
el.btnCopiar.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el.link.value);
    el.btnCopiar.textContent = 'Copiado!';
    setTimeout(() => { el.btnCopiar.textContent = 'Copiar'; }, 1500);
  } catch {
    el.link.select();
    aviso('Não consegui copiar sozinho. Selecionei o link — use Ctrl+C.');
  }
});

/* Usado pela limpeza ao fechar a aba (ver app.js). */
export function derrubarHost() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (peer && !peer.destroyed) peer.destroy();
}

