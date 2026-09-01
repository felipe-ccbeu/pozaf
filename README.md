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

## App de desktop (sem as bordas do navegador)

O mesmo projeto roda como app do Windows, numa janela sem moldura — nada de
barra de endereco, abas ou borda.

```bash
npm install
npm start
```

Se rodar pelo terminal do VS Code e der `Cannot read properties of undefined`,
use `npm run start:vscode`: o VS Code define `ELECTRON_RUN_AS_NODE=1`, que faz
o Electron subir como Node puro, sem interface. O script so limpa essa variavel.

### Configure o link antes de usar

**Este passo nao e opcional.** Dentro do app, `location.origin` e `file://`, e
um link `file://` nao abre na maquina de ninguem. Entao o app precisa saber o
endereco publico do site para montar o link da sala.

Na primeira execucao ele cria `desktop/config.json`. Abra e ponha o seu
endereco do GitHub Pages:

```json
{ "urlPublica": "https://seu-usuario.github.io/pozaf/" }
```

Enquanto isso nao for feito, o app mostra um aviso amarelo na barra.

**O site continua necessario.** O app deixa bonito o lado de QUEM COMPARTILHA;
seus amigos continuam entrando pelo link, no navegador deles. Publicar no
GitHub Pages segue sendo obrigatorio.

### Gerar o instalador

```bash
npm run build
```

Sai um `dist/Pozaf Setup 1.0.0.exe` (~150 MB — o Chromium vai junto, e e o que
garante a captura de tela com audio funcionando igual no Chrome).

### O que muda no app

| | Navegador | App |
|---|---|---|
| Moldura da janela | do sistema | nenhuma (arrasta pela barra) |
| Minimizar/fechar | do sistema | tres botoes na direita da barra |
| Seletor de tela | janela do Chrome | seletor nativo do Windows |
| Link da sala | `location.origin` | `urlPublica` do config.json |

Fechar pelo X ou por `Ctrl+W` encerra a transmissao, como esperado.

## Publicar no GitHub Pages

```bash
git add index.html css js README.md
git commit -m "compartilhamento de tela p2p"
git push
```

Depois: **Settings → Pages → Source: Deploy from a branch → `main` / `root`**
→ Save. Em ~1 minuto o site sai em
`https://<seu-usuario>.github.io/pozaf/`.

O GitHub Pages já serve HTTPS, então tudo funciona.

## Estrutura

```
index.html          marcação
css/base.css        paleta, tipografia, reset  ← mexa aqui p/ mudar o tema
css/header.css      barra, botões, seta, link
css/palco.css       vídeo, tela cheia, responsivo
js/app.js           roteamento host/espectador (ponto de entrada)
js/config.js        TURN, STUN                 ← mexa aqui p/ ligar o TURN
js/ui.js            status, avisos, a barra    ← mexa aqui p/ ajustes visuais
js/tela-cheia.js    fullscreen e atalhos F / H
js/host.js          capturar a tela e transmitir
js/espectador.js    entrar na sala e receber

desktop/main.js     app: cria a janela sem moldura (processo Node)
desktop/preload.js  app: a ponte segura entre o Node e a pagina
desktop/config.json app: a URL publica   ← mexa aqui p/ o link funcionar
js/desktop.js       app: botoes de janela e o link publico
css/desktop.css     app: arrastar a janela e os botoes
```

Os arquivos de `desktop/` e os dois `desktop.*` so tem efeito dentro do app.
No navegador, `js/desktop.js` verifica `window.pozaf` e nao faz nada, e o
`css/desktop.css` esta todo atras da classe `.no-desktop` — por isso o site
publicado continua identico.

Módulos ES nativos — continua **sem build step e sem npm**. O `index.html`
carrega só `js/app.js` com `type="module"`; os `import` puxam o resto.

## Configuração

Tudo que dá para ajustar está no bloco `CONFIG`, no topo de `js/config.js`:

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
