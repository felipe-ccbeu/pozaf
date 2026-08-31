# pozaf

Pra compartilhar tela com a tchurma.

Compartilhamento de tela peer-to-peer no navegador. Três arquivos estáticos,
sem backend, sem build, sem custo.

## Como funciona

A mesma página tem dois modos, decididos pela URL:

| URL | Modo |
|---|---|
| `.../pozaf/` | **host** — captura sua tela e abre uma sala |
| `.../pozaf/#sala=tela-a3f9x2` | **espectador** — entra na sala e só assiste |

O vídeo vai **direto de navegador para navegador** (WebRTC), criptografado.
O único servidor envolvido é o de sinalização (broker público do PeerJS), que
só apresenta os dois no começo e depois sai de cena — ele nunca vê a imagem.

Topologia **mesh**: o host abre uma conexão separada para cada espectador.
Ótimo até ~4 pessoas; acima disso o upload do host não aguenta.

## Rodar localmente

```bash
npx serve . -l 5173
```

Abra <http://localhost:5173>.

**Não funciona por `file://`.** `getDisplayMedia` e `navigator.clipboard`
exigem contexto seguro — ou seja, HTTPS ou `localhost`.

## Testar sozinho, com duas janelas

1. Abra <http://localhost:5173> → clique em **Compartilhar minha tela**
2. Escolha uma janela (não a própria aba, senão vira espelho infinito)
3. Copie o link que aparece
4. Abra uma **janela anônima** e cole o link → clique em **Entrar na sala**

Janela anônima porque o PeerJS guarda estado por origem; duas abas normais
podem confundir o broker.

## Publicar no GitHub Pages

```bash
git add index.html app.js estilo.css README.md
git commit -m "compartilhamento de tela p2p"
git push
```

Depois: **Settings → Pages → Source: Deploy from a branch → `main` / `root`**
→ Save. Em ~1 minuto o site sai em
`https://<seu-usuario>.github.io/pozaf/`.

O GitHub Pages já serve HTTPS, então tudo funciona.

## Configuração

Tudo que dá para ajustar está no bloco `CONFIG`, no topo de `app.js`:

- **TURN** (opcional): se algum amigo conectar mas o vídeo nunca aparecer, é
  NAT restritivo. Crie conta grátis em <https://dashboard.metered.ca> (20 GB/mês)
  e cole o subdomínio + API key. Sem isso, roda só com STUN — que resolve a
  maioria dos casos.
- **Qualidade**: seletor 1080p / 720p na própria página. 720p custa metade do
  upload e da CPU, e para ler texto é indistinguível.

## Limitações conhecidas

- **Áudio só no Chrome/Edge** do lado de quem compartilha. Firefox e Safari
  ignoram o pedido de áudio em silêncio. A página avisa quando isso acontece.
- **Upload do host** é o gargalo: ~2-3 Mbps por espectador em 1080p.
- O broker público do PeerJS não tem SLA. Se ele cair, quem já está assistindo
  continua (o vídeo é P2P), mas ninguém novo consegue entrar.
