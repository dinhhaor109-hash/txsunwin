const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next(); });

const PORT = process.env.PORT || 3001;

// Hỗ trợ Railway Volume (Nếu set DATA_DIR=/data trên Railway thì dữ liệu lưu vĩnh viễn không bao giờ mất)
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e){}
}
const DATA_FILE = path.join(DATA_DIR, 'history.json');

// ===== THU THẬP & LƯU TRỮ DỮ LIỆU =====
let lichSuMap = new Map();
let lichSu = [];
let currentSessionId = null;
let ws = null, pingInterval = null, reconnectTimeout = null, staleTimer = null;

// Khôi phục dữ liệu từ file khi khởi động
function loadDataFromFile() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(item => {
            if (item && item.Phien) lichSuMap.set(item.Phien, item);
          });
          syncArrayFromMap();
          console.log(`[💾 KHÔI PHỤC THÀNH CÔNG] Đã tải ${lichSu.length} phiên dữ liệu từ: ${DATA_FILE}`);
        }
      }
    } else {
      console.log(`[ℹ️] Chưa có file dữ liệu tại ${DATA_FILE}, sẽ tự động tạo mới khi có phiên.`);
    }
  } catch (e) {
    console.error('[❌] Lỗi đọc file data:', e.message);
  }
}

// Đồng bộ và ghi đĩa
function saveDataToFile() {
  try {
    syncArrayFromMap();
    fs.writeFileSync(DATA_FILE, JSON.stringify(lichSu, null, 2), 'utf-8');
    console.log(`[💾 ĐÃ LƯU] Đã ghi ${lichSu.length} phiên vào: ${DATA_FILE}`);
  } catch (e) {
    console.error('[❌] Lỗi ghi file data:', e.message);
  }
}

function syncArrayFromMap() {
  lichSu = Array.from(lichSuMap.values()).sort((a, b) => b.Phien - a.Phien);
}

// Đọc dữ liệu sẵn có
loadDataFromFile();

// ===== WEBSOCKET CONNECT =====
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const WS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Origin": "https://play.sun.win"
};

const INIT_MSGS = [
  [1,"MiniGame","GM_apivopnha","WangLin",{"info":"{\"ipAddress\":\"14.249.227.107\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiI5ODE5YW5zc3MiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMjMyODExNTEsImFmZklkIjoic3VuLndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzYzMDMyOTI4NzcwLCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjE0LjI0OS4yMjcuMTA3IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wNS5wbmciLCJwbGF0Zm9ybUlkIjo0LCJ1c2VySWQiOiI4ODM4NTMzZS1kZTQzLTRiOGQtOTUwMy02MjFmNDA1MDUzNGUiLCJyZWdUaW1lIjoxNzYxNjMyMzAwNTc2LCJwaG9uZSI6IiIsImRlcG9zaXQiOmZhbHNlLCJ1c2VybmFtZSI6IkdNX2FwaXZvcG5oYSJ9.guH6ztJSPXUL1cU8QdMz8O1Sdy_SbxjSM-CDzWPTr-0\",\"locale\":\"vi\",\"userId\":\"8838533e-de43-4b8d-9503-621f4050534e\",\"username\":\"GM_apivopnha\",\"timestamp\":1763032928770,\"refreshToken\":\"e576b43a64e84f789548bfc7c4c8d1e5.7d4244a361e345908af95ee2e8ab2895\"}","signature":"45EF4B318C883862C36E1B189A1DF5465EBB60CB602BA05FAD8FCBFCD6E0DA8CB3CE65333EDD79A2BB4ABFCE326ED5525C7D971D9DEDB5A17A72764287FFE6F62CBC2DF8A04CD8EFF8D0D5AE27046947ADE45E62E644111EFDE96A74FEC635A97861A425FF2B5732D74F41176703CA10CFEED67D0745FF15EAC1065E1C8BCBFA"}],
  [6,"MiniGame","taixiuPlugin",{cmd:1005}],
  [6,"MiniGame","lobbyPlugin",{cmd:10001}]
];

function connectWS() {
  if (ws) { ws.removeAllListeners(); try { ws.close(); } catch(e){} }
  ws = new WebSocket(WS_URL, { headers: WS_HEADERS });

  ws.on('open', () => {
    console.log('[✅] WebSocket connected - Đang thu thập dữ liệu...');
    INIT_MSGS.forEach((msg, i) => setTimeout(() => { if (ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); }, i*600));
    clearInterval(pingInterval);
    pingInterval = setInterval(() => { if (ws.readyState===WebSocket.OPEN) ws.ping(); }, 10000);
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => { console.log('[⚠️] Stale - reconnecting...'); ws.close(); }, 90000);
  });

  ws.on('pong', () => console.log('[📶] Connection Alive'));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data) || typeof data[1] !== 'object') return;
      const { cmd, sid, d1, d2, d3 } = data[1];

      // Nhận lô lịch sử ban đầu từ game (cmd 1005)
      if (cmd === 1005 && data[1].htr) {
        let addedCount = 0;
        data[1].htr.forEach(p => {
          if (!lichSuMap.has(p.sid)) {
            const t = p.d1 + p.d2 + p.d3;
            lichSuMap.set(p.sid, {
              Phien: p.sid,
              Xuc_xac_1: p.d1,
              Xuc_xac_2: p.d2,
              Xuc_xac_3: p.d3,
              Tong: t,
              Ket_qua: t > 10 ? 'Tài' : 'Xỉu',
              Created_at: new Date().toISOString()
            });
            addedCount++;
          }
        });
        if (addedCount > 0) {
          saveDataToFile();
          console.log(`[📋] Nối thêm ${addedCount} phiên mới vào kho dữ liệu`);
        }
      }

      if (cmd === 1008 && sid) currentSessionId = sid;

      // Nhận kết quả phiên mới vừa ra (cmd 1003)
      if (cmd === 1003 && d1 && d2 && d3) {
        clearTimeout(staleTimer);
        staleTimer = setTimeout(() => ws.close(), 90000);

        const targetPhien = sid || currentSessionId || (lichSu.length > 0 ? lichSu[0].Phien + 1 : 1);
        if (!lichSuMap.has(targetPhien)) {
          const t = d1 + d2 + d3;
          const entry = {
            Phien: targetPhien,
            Xuc_xac_1: d1,
            Xuc_xac_2: d2,
            Xuc_xac_3: d3,
            Tong: t,
            Ket_qua: t > 10 ? 'Tài' : 'Xỉu',
            Created_at: new Date().toISOString()
          };
          lichSuMap.set(targetPhien, entry);
          saveDataToFile();
          console.log(`[🎲 MỚI] Phiên ${targetPhien}: ${d1}-${d2}-${d3} = ${t} (${entry.Ket_qua}) | Tổng tích lũy: ${lichSu.length} phiên`);
        }
        currentSessionId = null;
      }
    } catch(e) { console.error('[❌] WS parse error:', e.message); }
  });

  ws.on('close', (code) => {
    console.log(`[🔌] Connection closed: ${code}. Reconnecting in 2.5s...`);
    clearInterval(pingInterval); clearTimeout(staleTimer); clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connectWS, 2500);
  });

  ws.on('error', (e) => { console.error('[❌] WS error:', e.message); try { ws.close(); } catch(_){} });
}

// ===== API ENDPOINTS =====

app.get('/api/lichsu', (req, res) => {
  const limit = parseInt(req.query.limit) || 0;
  if (limit > 0) return res.json(lichSu.slice(0, limit));
  res.json(lichSu);
});

app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 0;
  if (limit > 0) return res.json(lichSu.slice(0, limit));
  res.json(lichSu);
});

// Download dữ liệu JSON
app.get('/api/download', (req, res) => {
  if (fs.existsSync(DATA_FILE)) {
    return res.download(DATA_FILE, `sunwin_history_${Date.now()}.json`);
  }
  res.status(404).json({ error: 'Chưa có dữ liệu nào được lưu' });
});

// Import thủ công file/mảng JSON dữ liệu cũ để phục hồi
app.post('/api/import', (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Dữ liệu gửi lên phải là 1 mảng các phiên JSON' });
    }
    let added = 0;
    items.forEach(item => {
      if (item && item.Phien && !lichSuMap.has(item.Phien)) {
        lichSuMap.set(item.Phien, item);
        added++;
      }
    });
    saveDataToFile();
    res.json({ success: true, addedCount: added, totalSessions: lichSu.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Thống kê dữ liệu
app.get('/api/stats', (req, res) => {
  res.json({
    status: 'ACTIVE',
    dataFile: DATA_FILE,
    totalSessionsCollected: lichSu.length,
    latestSession: lichSu[0] || null,
    oldestSession: lichSu[lichSu.length - 1] || null,
    wsConnected: ws ? ws.readyState === WebSocket.OPEN : false
  });
});

app.get('/', (req, res) => {
  res.json({
    message: '🎲 Sunwin Data Collector Service',
    dataFile: DATA_FILE,
    totalSessionsCollected: lichSu.length,
    latestSession: lichSu[0] || null,
    endpoints: {
      history: '/api/lichsu',
      download: '/api/download',
      import: 'POST /api/import',
      stats: '/api/stats'
    }
  });
});

// ===== START SERVER =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server Thu thập Dữ liệu Sunwin đang chạy tại http://0.0.0.0:${PORT}`);
  console.log(`📁 Đường dẫn lưu file: ${DATA_FILE}`);
  connectWS();
});
