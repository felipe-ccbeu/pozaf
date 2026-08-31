/* ============================================================================
   CONFIG — servidores ICE (STUN/TURN)
   E aqui que voce mexe para ligar o TURN. Nada de WebRTC nem de interface
   neste arquivo: so configuracao e a montagem da lista de iceServers.
   ============================================================================ */

export const CONFIG = {

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
export async function montarIceServers() {
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
