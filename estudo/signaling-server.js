// Servidor de signaling minimo. Ele NAO participa do P2P —
// so repassa mensagens (offer/answer/candidates) entre dois navegadores.
//
//   npm init -y && npm install ws
//   node signaling-server.js
//
// Depois exponha na internet com:  npx localtunnel --port 3000
// (ou ngrok, ou faca deploy no Render/Railway/Fly)

const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 3000 });
const salas = new Map(); // nomeSala -> Set<WebSocket>

wss.on('connection', (ws) => {
  let sala = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // primeira mensagem: { tipo: 'entrar', sala: 'teste123' }
    if (msg.tipo === 'entrar') {
      sala = msg.sala;
      if (!salas.has(sala)) salas.set(sala, new Set());
      salas.get(sala).add(ws);
      console.log(`peer entrou na sala "${sala}" (${salas.get(sala).size} na sala)`);
      return;
    }

    // qualquer outra coisa (offer/answer/candidate): repassa pros OUTROS da sala
    if (sala && salas.has(sala)) {
      for (const outro of salas.get(sala)) {
        if (outro !== ws && outro.readyState === ws.OPEN) {
          outro.send(raw.toString());
        }
      }
    }
  });

  ws.on('close', () => {
    if (sala && salas.has(sala)) {
      salas.get(sala).delete(ws);
      if (salas.get(sala).size === 0) salas.delete(sala);
    }
  });
});

console.log('signaling server ouvindo em ws://localhost:3000');
