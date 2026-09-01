# Próximo passo no estudo de P2P

> Onde você parou: fez o teste PC (Wi-Fi) ↔ celular (4G) funcionar com o
> `manual.html`. Viu no log os candidatos `host` e `srflx`, o `ICE state:
> checking → connected` e trocou mensagens pelo DataChannel, sem servidor no
> meio do tráfego. Entendeu o papel do NAT, do STUN e do "furo" na porta.

---

## Passo 4 — matar o copia-e-cola: signaling automático via WebSocket

### A ideia

Hoje **você é o canal de signaling**: copia o texto da offer, cola no WhatsApp,
o outro lado cola de volta a answer. Funciona pra aprender, mas nenhum app real
faz isso.

O próximo passo é um **servidorzinho de signaling**: cada navegador abre um
WebSocket com ele, entra numa "sala" (só um nome qualquer, tipo `teste123`), e
tudo que um lado manda (offer, answer, candidatos ICE) o servidor **repassa**
para o outro lado da mesma sala.

**O P2P em si não muda nada.** O servidor de signaling só ajuda os dois a
trocarem os endereços no começo. Depois que a conexão direta sobe, ele podia
até cair.

```
  ANTES (manual.html)                  DEPOIS (auto.html)

  PC  --[copia offer]-->  você         PC  --offer-->  servidor  --offer-->  Celular
  você --[cola no zap]--> Celular      PC <--answer--  servidor <--answer--  Celular
  Celular --[copia answer]--> você     PC <-candidato-> servidor <-candidato-> Celular
  você --[cola de volta]--> PC              (tudo automático, via WebSocket)
```

### O que você aprende de novo aqui

| Conceito | O que é | Por que importa |
|----------|---------|-----------------|
| **Trickle ICE** | Em vez de esperar juntar TODOS os candidatos antes de exportar o SDP (o `waitForIceComplete` do `manual.html`), você manda cada candidato pelo WebSocket assim que ele aparece no `onicecandidate`. | Conecta muito mais rápido. É assim que o WebRTC funciona de verdade em produção. O "vanilla ICE" que usamos até agora só serve pra copiar/colar. |
| **`pc.addIceCandidate(c)`** | O lado que RECEBE cada candidato solto precisa injetá-lo na conexão com essa função. | Você nunca usou ela porque no vanilla ICE os candidatos já vinham embutidos dentro do SDP. Agora eles chegam avulsos. |
| **Ordem das mensagens** | Um candidato pode chegar antes do `setRemoteDescription`. Precisa de uma fila. | É a principal fonte de bug em signaling caseiro. |
| **Ciclo de vida do WebSocket** | Reconexão, sala com 2+ pessoas, o que fazer quando alguém sai. | Infra básica de qualquer app realtime. |

### O que já está pronto

O arquivo [`signaling-server.js`](./signaling-server.js) — servidor mínimo em
Node. Ele **não participa do P2P**, só repassa mensagens entre os navegadores
da mesma sala.

```bash
cd estudo
npm init -y
npm install ws
node signaling-server.js
# -> signaling server ouvindo em ws://localhost:3000
```

Para o celular no 4G alcançar o servidor que roda no seu PC, exponha na
internet:

```bash
npx localtunnel --port 3000
# -> te dá uma URL https://xxxx.loca.lt
```

(alternativas: `ngrok http 3000`, ou deploy grátis no Render / Railway / Fly.io)

### O que falta construir: `auto.html`

É uma evolução do `manual.html`. As mudanças:

1. **Sem `textarea`.** Um campo pra nome da sala + botão "Conectar".
2. **Abre um WebSocket** com o servidor de signaling e manda `{ tipo: 'entrar', sala }`.
3. **`pc.onicecandidate`** → em vez de acumular, faz `ws.send(JSON.stringify({ tipo: 'candidato', data: e.candidate }))`.
4. **`ws.onmessage`** → despacha por tipo:
   - `offer`  → `setRemoteDescription`, cria answer, `ws.send` a answer
   - `answer` → `setRemoteDescription`
   - `candidato` → `pc.addIceCandidate(data)`
5. **Quem cria a offer?** O primeiro que entrar na sala espera; o segundo que
   entrar dispara `createOffer`. (Ou o servidor avisa "você é o segundo".)

Esqueleto do cliente:

```js
const ws = new WebSocket('wss://xxxx.loca.lt');
const sala = 'teste123';
let pc;

ws.onopen = () => ws.send(JSON.stringify({ tipo: 'entrar', sala }));

ws.onmessage = async (ev) => {
  const msg = JSON.parse(ev.data);

  if (msg.tipo === 'pronto-pra-chamar') {
    // sou o segundo na sala -> eu inicio
    criarConexao();
    pc.onnegotiationneeded = async () => {
      await pc.setLocalDescription(await pc.createOffer());
      ws.send(JSON.stringify({ tipo: 'offer', data: pc.localDescription }));
    };
    pc.createDataChannel('chat'); // dispara negotiationneeded
  }

  if (msg.tipo === 'offer') {
    criarConexao();
    await pc.setRemoteDescription(msg.data);
    await pc.setLocalDescription(await pc.createAnswer());
    ws.send(JSON.stringify({ tipo: 'answer', data: pc.localDescription }));
  }

  if (msg.tipo === 'answer') {
    await pc.setRemoteDescription(msg.data);
  }

  if (msg.tipo === 'candidato') {
    try { await pc.addIceCandidate(msg.data); }
    catch (e) { console.warn('candidato falhou (normal se veio cedo demais)', e); }
  }
};

function criarConexao() {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      // TRICKLE: manda cada candidato assim que aparece
      ws.send(JSON.stringify({ tipo: 'candidato', data: e.candidate }));
    }
  };
  pc.ondatachannel = (e) => {
    const ch = e.channel;
    ch.onmessage = (m) => console.log('recebeu:', m.data);
  };
}
```

> Quando quiser montar o `auto.html` completo (com UI, log e o painel
> explicativo como no `manual.html`), é só pedir.

### Teste real do passo 4

1. `node signaling-server.js` no PC
2. `npx localtunnel --port 3000` → anota a URL
3. Coloca essa URL no `auto.html`, faz commit, Pages atualiza
4. PC no Wi-Fi: abre `.../estudo/auto.html`, sala `teste123`, Conectar
5. Celular no 4G: abre a MESMA URL, MESMA sala, Conectar
6. Conecta sozinho, sem copiar nada. Chat funciona igual.

---

## Roadmap depois do passo 4

| # | Tema | O que fazer | Por que importa |
|---|------|-------------|-----------------|
| 5 | **Vídeo e áudio** | Trocar o DataChannel por `navigator.mediaDevices.getUserMedia({ video: true, audio: true })` + `stream.getTracks().forEach(t => pc.addTrack(t, stream))`. Do outro lado, `pc.ontrack` → `videoEl.srcObject = e.streams[0]`. | É o caso de uso nº 1 de WebRTC (chamada de vídeo). Você vê a **renegociação de SDP** acontecer quando adiciona mídia numa conexão já aberta. |
| 6 | **TURN** | Subir um servidor `coturn` (Docker: `instrumentisto/coturn`) ou usar um serviço (Metered, Twilio, Cloudflare). Adicionar em `iceServers`. Forçar o uso com `iceTransportPolicy: 'relay'`. | Ver o candidato `relay` aparecer no log e entender na prática o que acontece quando o P2P direto falha — 10 a 20% das conexões reais no mundo precisam disso (NAT simétrico, CGNAT restrito, firewall corporativo). |
| 7 | **Perfect negotiation** | Implementar o padrão `polite / impolite peer` para os DOIS lados poderem iniciar a conexão sem dar conflito (*glare*). MDN tem o exemplo canônico. | É o padrão que apps reais usam. Resolve o problema "os dois mandaram offer ao mesmo tempo" de forma limpa. |
| 8 | **`getStats()` e webrtc-internals** | Ler `pc.getStats()` pra ver qual par de candidatos venceu, bitrate, packet loss, RTT. Abrir `chrome://webrtc-internals` durante uma conexão. | Debugar conexões de verdade. Saber *por que* uma chamada está ruim. |
| 9 | **Mais de 2 peers** | Mesh (cada um conecta com todos — simples, não escala) vs. SFU (um servidor recebe e redistribui os streams — o que Zoom/Meet usam). Ler sobre `mediasoup`, `ion-sfu`, LiveKit. | Entender por que chamadas com 10 pessoas precisam de servidor de mídia, e P2P puro só vai até ~4 participantes. |
| 10 | **Segurança e produção** | DTLS-SRTP (mídia sempre cifrada), autenticação no signaling, credenciais TURN temporárias (TURN REST API), lidar com `iceconnectionstatechange: disconnected` e ICE restart quando a rede muda. | O que separa um demo de um produto. |

---

## Arquivos deste estudo

| Arquivo | O que é |
|---------|---------|
| [`local.html`](./local.html) | Exemplo 0 — dois peers na mesma aba, zero servidor. Entender `RTCPeerConnection` e `RTCDataChannel` isolados. |
| [`manual.html`](./manual.html) | Exemplo 1 — PC ↔ celular real, signaling por copia-e-cola. Painel interativo explicando cada evento. **É o que você já rodou.** |
| [`diagrama.html`](./diagrama.html) | Artefato visual — o caminho de um pacote pela internet, NAT, STUN, candidatos ICE, quando o TURN é preciso. Leitura de apoio. |
| [`signaling-server.js`](./signaling-server.js) | Servidor de signaling mínimo em Node. **Ponto de partida do passo 4.** |
| `auto.html` | *(a construir no passo 4)* |

---

## Leitura recomendada antes do passo 4

- **MDN — "Signaling and video calling"**: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling — o tutorial oficial, cobre exatamente o passo 4 e 5.
- **MDN — "Perfect negotiation"**: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation — pro passo 7.
- **webrtcforthecurious.com** — livro grátis, explica o protocolo por baixo. Capítulos "Signaling" e "Connecting".
