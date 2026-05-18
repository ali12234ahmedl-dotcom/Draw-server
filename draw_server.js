// made by mohamed
const express    = require("express");
const http       = require("http");
const { WebSocketServer } = require("ws");
const { randomBytes } = require("crypto");
const { URL }    = require("url");

const PORT = process.env.PORT || 3000;
const HOST = process.env.PUBLIC_HOST || `http://localhost:${PORT}`;

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ noServer: true });

app.use(express.json());

const sessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > 15 * 60 * 1000) sessions.delete(id);
  }
}, 60_000);


// made by mohamed

app.post("/api/draw/session", (req, res) => {
  const { word } = req.body;
  if (!word) return res.status(400).json({ error: "word is required" });

  const id    = randomBytes(8).toString("hex");
  const token = randomBytes(16).toString("hex");
  sessions.set(id, { id, token, word, snapshot: null, createdAt: Date.now() });

  res.json({
    sessionId: id,
    token,
    canvasUrl: `${HOST}/api/draw/canvas/${id}?token=${token}`,
  });
});

// made by mohamed
app.get("/api/draw/:sessionId/snapshot", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (!session.snapshot) {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Has-Content", "false");
    return res.send(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    ));
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("X-Has-Content", "true");
  res.send(session.snapshot);
});


app.delete("/api/draw/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Not found" });
  if (session.token !== req.query.token) return res.status(403).json({ error: "Forbidden" });
  sessions.delete(session.id);
  res.json({ ok: true });
});

app.get("/api/draw/canvas/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).send("<h1>Session not found or expired</h1>");
  if (req.query.token !== session.token) return res.status(403).send("<h1>Invalid link</h1>");

  const wsProtocol = HOST.startsWith("https") ? "wss" : "ws";
  const wsHost     = HOST.replace(/^https?:\/\//, "");
  const wsUrl      = `${wsProtocol}://${wsHost}/api/draw/ws/${session.id}?token=${session.token}`;
  const word       = session.word;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Draw — ${word.toUpperCase()}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#1a1a2e;color:#fff;font-family:'Segoe UI',sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:12px;user-select:none;}
  .word-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;margin-top:8px;}
  .word-box{background:#16213e;border:2px solid #e94560;border-radius:12px;padding:10px 28px;margin-bottom:12px;font-size:26px;font-weight:bold;letter-spacing:3px;color:#e94560;text-transform:uppercase;}
  .toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px;background:#16213e;padding:10px 14px;border-radius:12px;flex-wrap:wrap;justify-content:center;max-width:720px;width:100%;}
  .colors{display:flex;gap:5px;flex-wrap:wrap;}
  .cb{width:26px;height:26px;border-radius:50%;border:3px solid transparent;cursor:pointer;flex-shrink:0;transition:transform .15s;}
  .cb.active{border-color:#fff!important;transform:scale(1.2);}
  .tool-btn{background:#0f3460;border:none;color:#fff;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:13px;transition:background .2s;white-space:nowrap;}
  .tool-btn:hover,.tool-btn.active{background:#e94560;}
  .size-wrap{display:flex;flex-direction:column;align-items:center;gap:2px;}
  .size-wrap label{font-size:11px;color:#aaa;}
  input[type=range]{width:80px;accent-color:#e94560;}
  #canvas{border-radius:10px;touch-action:none;box-shadow:0 4px 24px rgba(0,0,0,.6);background:#fff;max-width:100%;cursor:crosshair;}
  .status{margin-top:10px;font-size:13px;color:#666;text-align:center;padding:6px 14px;border-radius:8px;background:#16213e;}
  .status.ok{color:#4caf50;}
  .status.err{color:#e94560;}
</style>
</head>
<body>
<div class="word-label">Your word to draw</div>
<div class="word-box">${word}</div>

<div class="toolbar">
  <div class="colors" id="clrs"></div>
  <div style="width:1px;height:26px;background:#333"></div>
  <button class="tool-btn active" id="penBtn"    onclick="setTool('pen')">✏️ Pen</button>
  <button class="tool-btn"        id="eraserBtn" onclick="setTool('eraser')">🧹 Eraser</button>
  <button class="tool-btn"                       onclick="clearCanvas()">🗑️ Clear</button>
  <div class="size-wrap">
    <label>Size: <span id="sv">6</span>px</label>
    <input type="range" id="sz" min="2" max="50" value="6"
           oninput="brushSize=+this.value;document.getElementById('sv').textContent=brushSize">
  </div>
</div>

<canvas id="canvas" width="700" height="480"></canvas>
<div class="status" id="status">Connecting…</div>

<script>
const COLORS = [
  '#000000','#ffffff','#e74c3c','#e67e22','#f39c12',
  '#2ecc71','#1abc9c','#3498db','#2980b9','#9b59b6',
  '#e91e63','#ff5722','#795548','#607d8b'
];
const clrs = document.getElementById('clrs');
let curColor = '#000000', curTool = 'pen', brushSize = 6;

COLORS.forEach(c => {
  const b = document.createElement('div');
  b.className = 'cb' + (c === curColor ? ' active' : '');
  b.style.background = c;
  b.style.border = '3px solid ' + (c === curColor ? '#fff' : (c === '#ffffff' ? '#555' : 'transparent'));
  b.onclick = () => {
    document.querySelectorAll('.cb').forEach(x => { x.classList.remove('active'); x.style.borderColor = 'transparent'; });
    b.classList.add('active');
    b.style.borderColor = '#fff';
    curColor = c;
    setTool('pen');
  };
  clrs.appendChild(b);
});

function setTool(t) {
  curTool = t;
  document.getElementById('penBtn').classList.toggle('active', t === 'pen');
  document.getElementById('eraserBtn').classList.toggle('active', t === 'eraser');
}

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
ctx.fillStyle = '#fff';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

let drawing = false, lx = 0, ly = 0;

function pos(e) {
  const r  = canvas.getBoundingClientRect();
  const sx = canvas.width  / r.width;
  const sy = canvas.height / r.height;
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return [(cx - r.left) * sx, (cy - r.top) * sy];
}

function startDraw(e) { drawing = true; [lx, ly] = pos(e); }
function doDraw(e) {
  if (!drawing) return;
  const [x, y] = pos(e);
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(x, y);
  ctx.lineWidth   = curTool === 'eraser' ? brushSize * 3 : brushSize;
  ctx.strokeStyle = curTool === 'eraser' ? '#ffffff' : curColor;
  ctx.stroke();
  lx = x; ly = y;
}
function endDraw() { if (drawing) { drawing = false; sendSnap(); } }

canvas.addEventListener('mousedown',  startDraw);
canvas.addEventListener('mousemove',  doDraw);
canvas.addEventListener('mouseup',    endDraw);
canvas.addEventListener('mouseleave', endDraw);
canvas.addEventListener('touchstart', e => { e.preventDefault(); startDraw(e); }, { passive: false });
canvas.addEventListener('touchmove',  e => { e.preventDefault(); doDraw(e);   }, { passive: false });
canvas.addEventListener('touchend',   endDraw);

function clearCanvas() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); sendSnap(); }

let ws, snapDirty = false;
function sendSnap() { snapDirty = true; }

setInterval(() => {
  if (snapDirty && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'snapshot', data: canvas.toDataURL('image/png') }));
    snapDirty = false;
  }
}, 1800);

function connect() {
  const st = document.getElementById('status');
  ws = new WebSocket('${wsUrl}');
  ws.onopen  = () => { st.textContent = '🟢 Connected — your strokes update live in Discord!'; st.className = 'status ok'; };
  ws.onclose = () => { st.textContent = '🔴 Disconnected — reconnecting…'; st.className = 'status err'; setTimeout(connect, 3000); };
  ws.onerror = () => ws.close();
}
connect();
</script>
</body>
</html>`);
});



server.on("upgrade", (req, socket, head) => {
  const url   = new URL(req.url ?? "/", "http://localhost");
  const match = url.pathname.match(/^\/api\/draw\/ws\/([a-f0-9]+)$/);

  if (!match) { socket.destroy(); return; }

  const sessionId = match[1];
  const token     = url.searchParams.get("token");
  const session   = sessions.get(sessionId);

  if (!session || session.token !== token) { socket.destroy(); return; }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "snapshot" && msg.data) {
          const base64 = msg.data.replace(/^data:image\/png;base64,/, "");
          session.snapshot = Buffer.from(base64, "base64");
        }
      } catch { /* ignore malformed */ }
    });
  });
});


// made by mohamed

server.listen(PORT, () => {
  console.log(`✅ Drawing canvas server running on port ${PORT}`);
  console.log(`   PUBLIC_HOST = ${HOST}`);
  console.log(`   Set PUBLIC_HOST env var to your public URL (e.g. https://yourdomain.com)`);
});

// Reviewed by ALi ✅
