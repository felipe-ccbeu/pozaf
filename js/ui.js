/* ============================================================================
   UI — elementos da pagina, status, avisos e a barra
   Tudo que desenha ou esconde coisa na tela mora aqui. Nenhuma linha de
   WebRTC: e o arquivo para mexer quando a mudanca e so visual.
   ============================================================================ */

const $ = (id) => document.getElementById(id);

export const el = {
  barra:       $('barra'),
  painel:      $('painel'),
  btnHeader:   $('btn-header'),
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
export function textoBotao(t) { el.btn.querySelector('span').textContent = t; }

/** Escreve o status na tela. tipo: '' | 'ok' | 'erro' */
export function status(texto, tipo = '') {
  el.status.textContent = texto;
  el.status.className = tipo;
  console.log('[status]', texto);
}

/** Aviso amarelo persistente (sem áudio, NAT, etc.). Sem texto = esconde. */
export function aviso(texto) {
  el.aviso.textContent = texto || '';
  el.aviso.hidden = !texto;
}

/** Mostra o vídeo e some com o placeholder "nada sendo exibido". */
export function mostrarVideo() {
  el.video.hidden = false;
  el.vazio.hidden = true;
}

/* ---- A barra que recolhe -----------------------------------------------------
   Modelo simples e previsivel: o header tem DOIS estados, aberto ou
   recolhido, e so muda quando VOCE manda. Nada de hover, nada de timer —
   assim ele nunca some no meio de um clique nem reaparece sozinho.

     aberto    -> seta para CIMA, pendurada embaixo da barra, recolhe
     recolhido -> a mesma seta gira para BAIXO e reabre

   A tecla H alterna os dois. */

export function recolherHeader() {
  el.barra.classList.add('recolhido');
  el.btnHeader.classList.add('fechado');       // gira a seta para baixo
  el.btnHeader.setAttribute('aria-expanded', 'false');
  el.btnHeader.setAttribute('aria-label', 'Mostrar barra');
  el.btnHeader.title = 'Mostrar barra (H)';

  /* Se o foco estiver num controle que acabou de sair de vista, o navegador
     o mantem focado mas invisivel. Trazemos o foco para o botao. */
  if (el.painel.contains(document.activeElement)) el.btnHeader.focus();
}

export function abrirHeader() {
  el.barra.classList.remove('recolhido');
  el.btnHeader.classList.remove('fechado');
  el.btnHeader.setAttribute('aria-expanded', 'true');
  el.btnHeader.setAttribute('aria-label', 'Recolher barra');
  el.btnHeader.title = 'Recolher barra (H)';
}

export function alternarHeader() {
  if (el.barra.classList.contains('recolhido')) abrirHeader();
  else recolherHeader();
}

el.btnHeader.addEventListener('click', alternarHeader);

/* Chamadas pelo fluxo de transmissao. O header NUNCA se recolhe sozinho:
   liberarHeader existe so para manter as chamadas do fluxo sem efeito, e
   prenderHeader garante que uma mensagem importante (erro, fim da
   transmissao) apareca mesmo com a barra recolhida. */
export function liberarHeader() { /* nada: quem recolhe e o usuario, no clique */ }
export function prenderHeader()  { abrirHeader(); }
