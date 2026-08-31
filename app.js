/* ============================================================================
   TELA — compartilhamento de tela peer-to-peer, sem backend
   ============================================================================

   COMO ISSO FUNCIONA, EM 30 SEGUNDOS

   WebRTC permite que dois navegadores mandem vídeo DIRETO um pro outro, sem
   servidor no meio. Mas eles precisam se achar primeiro — e você não sabe o
   IP do seu amigo. Quem faz essa apresentação é o "servidor de sinalização"
   (aqui: o broker público e gratuito do PeerJS).

   O broker só troca envelopes de texto no começo:
     "esse é o endereço do fulano", "esse é o formato de vídeo que ele aceita".
   Depois que o túnel abre, ele SAI DE CENA. O vídeo nunca passa por ele.
   Nem por ele, nem pelo GitHub. É direto, e criptografado (DTLS/SRTP).

   O PeerJS embrulha o WebRTC em duas ideias:
     peer.connect(id)         -> canal de DADOS  (texto)
     peer.call(id, stream)    -> canal de MÍDIA  (áudio/vídeo)

   Usamos os dois. O canal de dados é só a campainha: o espectador toca para
   avisar "cheguei, e meu id é esse". Aí o host liga de volta com o vídeo.
   Precisa ser nessa ordem porque quem tem a mídia é o host — ele é quem
   precisa saber o id do espectador para poder chamar.

   TOPOLOGIA: MESH
   O host abre uma conexão SEPARADA para cada espectador, e o navegador
   codifica o vídeo de novo em cada uma. Com 3 espectadores em 1080p isso é
   ~6-9 Mbps de upload e 3 encoders rodando na sua CPU. Ótimo até ~4 pessoas
   (custo de servidor: zero). Acima disso, o upload do host derrete — aí só
   com um servidor SFU no meio, o que acabaria com o "grátis".
   ============================================================================ */

'use strict';

/* ============================================================================
   1) CONFIGURAÇÃO — é aqui que você mexe
   ============================================================================ */

const CONFIG = {

  /* ---------------------------------------------------------------------
     TURN (opcional, mas resolve o caso "conecta e o vídeo nunca aparece").

     STUN só descobre seu IP público — resolve a MAIORIA das conexões, de
     graça e sem cadastro. Mas em CGNAT de operadora, rede corporativa ou
     4G/5G restrito, os dois lados não conseguem se enxergar de jeito nenhum.
     Aí é preciso um TURN: um relay que fica no meio repassando os pacotes.
     Não existe TURN público sem cadastro.

     PARA LIGAR (grátis, 20 GB/mês):
       1. crie a conta em https://dashboard.metered.ca/
       2. o painel te dá um subdomínio (ex.: "minhatela") e uma API key
       3. cole os dois abaixo e salve. Só isso.

     AVISO HONESTO: a página é estática e pública, então essa chave fica
     visível para quem abrir o DevTools ou ler seu repositório. Não tem como
     esconder sem um backend. Na prática, com uma página obscura e TURN
     usado só como plano B, os 20 GB sobram — e você pode trocar a chave no
     painel se ver consumo estranho.

     Deixe em "" para rodar só com STUN. Funciona, e é o padrão.
     --------------------------------------------------------------------- */
  METERED_SUBDOMINIO: '',
  METERED_API_KEY:    '',

  /* Se o vídeo não chegar nesse tempo, avisamos que provavelmente é NAT. */
  SEGUNDOS_ATE_DESISTIR: 15,
};

/* STUN do Google — grátis, sem cadastro, sem limite prático.
   Dois endereços porque se o primeiro estiver lento o ICE tenta o outro. */
const STUN_PADRAO = [
  { urls: 'stun:stun.l.google.com:19302'  },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Monta a lista de servidores ICE que o WebRTC vai usar para furar o NAT.
 * Sempre devolve o STUN; acrescenta o TURN só se você configurou a Metered.
 * Se o fetch da Metered falhar, seguimos com STUN em vez de quebrar tudo.
 */
async function montarIceServers() {
  if (!CONFIG.METERED_API_KEY || !CONFIG.METERED_SUBDOMINIO) {
    return STUN_PADRAO;
  }
  try {
    const url = `https://${CONFIG.METERED_SUBDOMINIO}.metered.live`
              + `/api/v1/turn/credentials?apiKey=${CONFIG.METERED_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const turn = await resp.json();
    console.log('[ice] TURN da Metered carregado:', turn.length, 'servidores');
    return STUN_PADRAO.concat(turn);
  } catch (e) {
    console.warn('[ice] TURN indisponível, seguindo só com STUN:', e.message);
    return STUN_PADRAO;
  }
}

/* ============================================================================
   2) ATALHOS DE TELA
   Toda mensagem importante vai para a tela, não só para o console — o console
   ninguém abre quando algo dá errado no meio de uma call.
   ============================================================================ */

const $ = (id) => document.getElementById(id);

const el = {
  painel:    $('painel'),
  gatilho:   $('gatilho'),
  modo:      $('modo'),
  qualidade: $('qualidade'),
  selQual:   $('sel-qualidade'),
  btn:       $('btn-principal'),
  btnParar:  $('btn-parar'),
  btnFull:   $('btn-fullscreen'),
  txtFull:   $('txt-fullscreen'),
  areaLink:  $('area-link'),
  link:      $('link'),
  btnCopiar: $('btn-copiar'),
  status:    $('status'),
  contador:  $('contador'),
  aviso:     $('aviso'),
  video:     $('video'),
  vazio:     $('vazio'),
};

/* O botão principal tem um <span> dentro (por causa do estilo), então
   escrever nele exige mirar o span e não o botão. */
function textoBotao(t) { el.btn.querySelector('span').textContent = t; }

/** Escreve o status na tela. tipo: '' | 'ok' | 'erro' */
function status(texto, tipo = '') {
  el.status.textContent = texto;
  el.status.className = tipo;
  console.log('[status]', texto);
}

/** Aviso amarelo persistente (sem áudio, NAT, etc.). Sem texto = esconde. */
function aviso(texto) {
  el.aviso.textContent = texto || '';
  el.aviso.hidden = !texto;
}

/** Mostra o vídeo e some com o placeholder "nada sendo exibido". */
function mostrarVideo() {
  el.video.hidden = false;
  el.vazio.hidden = true;
}

/* ============================================================================
   3) ESTADO GLOBAL
   ============================================================================ */

let peer   = null;   // nosso objeto Peer (a "linha telefônica")
let stream = null;   // só no host: a captura da tela

/* Só no host. Chave = id do espectador, valor = { conn, chamada }.
   Guardamos as duas pontas para poder fechar tudo quando ele sair. */
const espectadores = new Map();

/* ============================================================================
   4) ROTEAMENTO — a mesma página, dois modos

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
  el.modo.textContent = 'espectador · sala ' + salaAlvo;
  textoBotao('Entrar na sala');
  el.btn.disabled     = false;
  status('Pronto. Clique em "Entrar na sala".');

  /* O clique é OBRIGATÓRIO, não é preguiça de UI: o stream vem com áudio, e
     todo navegador bloqueia autoplay com som sem um gesto do usuário. Se
     tentássemos conectar sozinhos no load, o vídeo chegaria e ficaria
     congelado no primeiro quadro, mudo. */
  el.btn.addEventListener('click', entrarNaSala, { once: true });

} else {
  /* ------------------------------------------------------ MODO HOST */
  el.modo.textContent = 'host — você compartilha';
  textoBotao('Compartilhar minha tela');
  el.btn.disabled     = false;
  el.qualidade.hidden = false;
  status('Pronto. Escolha a qualidade e clique para compartilhar.');

  el.btn.addEventListener('click', iniciarHost);
  el.btnParar.addEventListener('click', encerrarHost);
}

/* ============================================================================
   5) FLUXO DO HOST
   ============================================================================ */

async function iniciarHost() {
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
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, width: { max: largura } },
      audio: true,
    });
  } catch (err) {
    el.btn.disabled = false;
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

  peer = new Peer(idSala, {
    config: { iceServers },   // <- vai direto para o RTCPeerConnection
    debug: 1,
  });

  /* --- "open": o broker aceitou nosso id. Só agora a sala existe. ------- */
  peer.on('open', (idConfirmado) => {
    const url = `${location.origin}${location.pathname}#sala=${idConfirmado}`;
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
function encerrarHost() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());   // apaga o ícone de captura
    stream = null;
  }
  if (peer && !peer.destroyed) peer.destroy();     // fecha todas as conexões
  peer = null;
  espectadores.clear();

  el.video.srcObject = null;
  el.video.hidden    = true;
  el.vazio.hidden    = false;
  el.vazio.textContent = 'Compartilhamento encerrado.';
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

/* ============================================================================
   6) FLUXO DO ESPECTADOR
   ============================================================================ */

async function entrarNaSala() {
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

/* ============================================================================
   7) INTERFACE — header auto-oculto e tela cheia
   ============================================================================ */

/* ---- 7.1 Header que se esconde ---------------------------------------------
   Ideia: o header vive escondido acima da tela. Ele desce quando:
     - o mouse encosta nos 8px do topo (#gatilho), ou
     - o mouse está por cima do próprio header, ou
     - algo dentro dele tem o foco do teclado (acessibilidade: quem navega
       por Tab não pode perder os controles de vista), ou
     - estamos "presos" abertos, por exemplo antes de começar a transmitir.

   Sobe de novo pouco depois que nada disso vale mais. O atraso existe porque
   sem ele o header pisca toda vez que o mouse cruza o topo de passagem. */

const ATRASO_PARA_ESCONDER = 900;   // ms

let presoAberto   = true;   // começa aberto: o usuário precisa ver o botão
let mouseNoHeader = false;
let timerEsconder = null;

function mostrarHeader() {
  clearTimeout(timerEsconder);
  el.painel.classList.add('visivel');
}

function esconderHeaderEmBreve() {
  clearTimeout(timerEsconder);

  /* Nunca esconde se estamos presos abertos, se o mouse está em cima, ou se
     o foco do teclado está lá dentro. */
  if (presoAberto || mouseNoHeader) return;
  if (el.painel.contains(document.activeElement)) return;

  timerEsconder = setTimeout(() => {
    if (presoAberto || mouseNoHeader) return;
    if (el.painel.contains(document.activeElement)) return;
    el.painel.classList.remove('visivel');
  }, ATRASO_PARA_ESCONDER);
}

/* Solta o header para poder se esconder. Chamamos quando a transmissão
   começa de verdade — antes disso, esconder só atrapalharia. */
function liberarHeader() {
  presoAberto = false;
  esconderHeaderEmBreve();
}

/* Volta a prender o header aberto (transmissão encerrada, erro, etc.). */
function prenderHeader() {
  presoAberto = true;
  mostrarHeader();
}

el.gatilho.addEventListener('mouseenter', mostrarHeader);

el.painel.addEventListener('mouseenter', () => {
  mouseNoHeader = true;
  mostrarHeader();
});
el.painel.addEventListener('mouseleave', () => {
  mouseNoHeader = false;
  esconderHeaderEmBreve();
});

/* Foco por teclado mantém o header à vista. focusin/focusout borbulham,
   ao contrário de focus/blur — por isso usamos estes. */
el.painel.addEventListener('focusin',  mostrarHeader);
el.painel.addEventListener('focusout', esconderHeaderEmBreve);

/* Em toque não existe hover: um toque em qualquer lugar revela o header
   por alguns segundos. */
el.video.addEventListener('click', () => {
  mostrarHeader();
  esconderHeaderEmBreve();
});

/* Rede de segurança para o mouse: se o cursor estiver bem no topo da janela,
   mostra. Cobre o caso do mouse entrar rápido demais e o mouseenter do
   #gatilho não disparar. */
document.addEventListener('mousemove', (e) => {
  if (e.clientY <= 6) mostrarHeader();
});

mostrarHeader();   // estado inicial: visível

/* ---- 7.2 Tela cheia ---------------------------------------------------------
   requestFullscreen() é uma promise e SÓ funciona a partir de um gesto do
   usuário — por isso está amarrado a um clique/tecla, nunca chamado sozinho.
   Usamos o <body> e não o <video> de propósito: com o body em fullscreen o
   header continua acessível por cima. Se puséssemos o <video>, o navegador
   mostraria só o vídeo e perderíamos os controles. */

function emTelaCheia() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

async function alternarTelaCheia() {
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
  if (tecla === 'h') {
    e.preventDefault();
    if (el.painel.classList.contains('visivel')) {
      presoAberto = false;
      el.painel.classList.remove('visivel');
    } else {
      prenderHeader();
    }
  }
});

/* ============================================================================
   8) LIMPEZA AO FECHAR A ABA
   Sem isso, o host some sem avisar e os espectadores ficam olhando um vídeo
   congelado por um bom tempo até o WebRTC perceber sozinho.
   ============================================================================ */
window.addEventListener('pagehide', () => {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (peer && !peer.destroyed) peer.destroy();
});
