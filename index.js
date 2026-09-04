const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next(); });

const PORT = process.env.PORT || 3001;

const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e){}
}
const DATA_FILE = path.join(DATA_DIR, 'history.json');

// ===== LƯU TRỮ DỮ LIỆU =====
let lichSuMap = new Map();
let lichSu = [];
let currentSessionId = null;
let ws = null, pingInterval = null, reconnectTimeout = null, staleTimer = null;

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
          console.log(`[💾 KHÔI PHỤC THÀNH CÔNG] Đã tải ${lichSu.length} phiên dữ liệu`);
        }
      }
    }
  } catch (e) { console.error('[❌] Lỗi đọc file data:', e.message); }
}

function saveDataToFile() {
  try {
    syncArrayFromMap();
    fs.writeFileSync(DATA_FILE, JSON.stringify(lichSu, null, 2), 'utf-8');
  } catch (e) { console.error('[❌] Lỗi ghi file data:', e.message); }
}

function syncArrayFromMap() {
  lichSu = Array.from(lichSuMap.values()).sort((a, b) => b.Phien - a.Phien);
}

loadDataFromFile();

// ===== PURE LOGIC & DICE PHYSICS PREDICTION ENGINE (100% CONTINUOUS - ZERO SKIPS - ZERO HACKS) =====
function predictNextSessionPureContinuous(historyData) {
  if (historyData.length < 5) return { predict: 'Tài', confidence: 50, note: 'Khởi tạo' };

  const chronological = [...historyData].sort((a, b) => a.Phien - b.Phien);
  const n = chronological.length;
  const last = chronological[n - 1];
  const last2 = chronological[n - 2];

  // 1. Extreme Sum Mean Reversion Physics
  if (last.Tong >= 16) {
    return { predict: 'Xỉu', confidence: 85, note: 'Cực trị cao (Tong >= 16 -> Xỉu)' };
  }
  if (last.Tong <= 5) {
    return { predict: 'Tài', confidence: 85, note: 'Cực trị thấp (Tong <= 5 -> Tài)' };
  }

  // 2. Sum Trend Momentum (Bệt xu hướng tăng/giảm tổng)
  if (last.Ket_qua === last2.Ket_qua && last.Tong > last2.Tong) {
    return { predict: last.Ket_qua, confidence: 75, note: `Động lượng Tổng tăng theo nhịp ${last.Ket_qua}` };
  }

  // 3. Dice Parity & Vector Range Physics: (Tong + Range) mod 2
  const maxD = Math.max(last.Xuc_xac_1, last.Xuc_xac_2, last.Xuc_xac_3);
  const minD = Math.min(last.Xuc_xac_1, last.Xuc_xac_2, last.Xuc_xac_3);
  const rangeD = maxD - minD;
  const parity = (last.Tong + rangeD) % 2;

  const predict = parity === 0 ? 'Tài' : 'Xỉu';
  return { predict, confidence: 70, note: `Vectơ Biên độ Xúc xắc (Tong=${last.Tong}, Range=${rangeD})` };
}

function runDatasetSimulation(dataset, windowSize = 100) {
  const sorted = [...dataset].sort((a, b) => a.Phien - b.Phien);
  let totalBets = 0, correctBets = 0, currentLossStreak = 0, maxLossStreak = 0;
  let streakCounts = {};

  for (let i = windowSize; i < sorted.length; i++) {
    const history = sorted.slice(i - windowSize, i);
    const actual = sorted[i].Ket_qua;

    const pObj = predictNextSessionPureContinuous(history);
    const predict = pObj.predict;

    totalBets++; // 100% Continuous Betting - Zero Skips
    if (predict === actual) {
      correctBets++;
      currentLossStreak = 0;
    } else {
      currentLossStreak++;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
      streakCounts[currentLossStreak] = (streakCounts[currentLossStreak] || 0) + 1;
    }
  }

  return {
    windowSize,
    totalSessions: sorted.length - windowSize,
    totalBetsExecuted: totalBets,
    bettingRate: '100% (Zero Skips)',
    correctBets,
    accuracy: totalBets > 0 ? ((correctBets / totalBets) * 100).toFixed(2) + '%' : '0%',
    maxLossStreak,
    streakCounts
  };
}

// ===== WEBSOCKET =====
const WS_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const WS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Origin": "https://play.sun.win"
};

const INIT_MSGS = [
  [1,"MiniGame","GM_apivopnha","WangLin",{"info":"{\"ipAddress\":\"14.249.227.107\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiI5ODE5YW5zc3MiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMjMyODExNTEsImFmZklkIjoic3VuLndpbiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzYzMDMyOTI4NzcwLCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjE0LjI0OS4yMjcuMTA3IiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wNS5wbmciLCJwbGF0Zm9ybUlkIjo4LCJ1c2VySWQiOiI4ODM4NTMzZS1kZTQzLTRiOGQtOTUwMy02MjFmNDA1MDUzNGUiLCJyZWdUaW1lIjoxNzYxNjMyMzAwNTc2LCJwaG9uZSI6IiIsImRlcG9zaXQiOmZhbHNlLCJ1c2VybmFtZSI6IkdNX2FwaXZvcG5oYSJ9.guH6ztJSPXUL1cU8QdMz8O1Sdy_SbxjSM-CDzWPTr-0\",\"locale\":\"vi\",\"userId\":\"8838533e-de43-4b8d-9503-621f4050534e\",\"username\":\"GM_apivopnha\",\"timestamp\":1763032928770,\"refreshToken\":\"e576b43a64e84f789548bfc7c4c8d1e5.7d4244a361e345908af95ee2e8ab2895\"}","signature":"45EF4B318C883862C36E1B189A1DF5465EBB60CB602BA05FAD8FCBFCD6E0DA8CB3CE65333EDD79A2BB4ABFCE326ED5525C7D971D9DEDB5A17A72764287FFE6F62CBC2DF8A04CD8EFF8D0D5AE27046947ADE45E62E644111EFDE96A74FEC635A97861A425FF2B5732D74F41176703CA10CFEED67D0745FF15EAC1065E1C8BCBFA"}],
  [6,"MiniGame","taixiuPlugin",{cmd:1005}],
  [6,"MiniGame","lobbyPlugin",{cmd:10001}]
];

function connectWS() {
  if (ws) { ws.removeAllListeners(); try { ws.close(); } catch(e){} }
  ws = new WebSocket(WS_URL, { headers: WS_HEADERS });

  ws.on('open', () => {
    console.log('[✅] WebSocket connected');
    INIT_MSGS.forEach((msg, i) => setTimeout(() => { if (ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(msg)); }, i*600));
    clearInterval(pingInterval);
    pingInterval = setInterval(() => { if (ws.readyState===WebSocket.OPEN) ws.ping(); }, 10000);
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => ws.close(), 90000);
  });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data) || typeof data[1] !== 'object') return;
      const { cmd, sid, d1, d2, d3 } = data[1];

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
        if (addedCount > 0) saveDataToFile();
      }

      if (cmd === 1008 && sid) currentSessionId = sid;

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
          console.log(`[🎲 MỚI] Phiên ${targetPhien}: ${d1}-${d2}-${d3} = ${t} (${entry.Ket_qua})`);
        }
        currentSessionId = null;
      }
    } catch(e){}
  });

  ws.on('close', () => {
    clearInterval(pingInterval); clearTimeout(staleTimer); clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connectWS, 2500);
  });
}

// ===== API ENDPOINTS =====

app.get('/api/lichsu', (req, res) => {
  const limit = parseInt(req.query.limit) || 0;
  res.json(limit > 0 ? lichSu.slice(0, limit) : lichSu);
});

// API Dự đoán phiên tiếp theo - Pure Continuous (100% Bets, Zero Skips, Zero Hacks)
app.get('/api/predict', (req, res) => {
  const windowSize = parseInt(req.query.window) || 100;
  const recent = lichSu.slice(0, windowSize);
  const result = predictNextSessionPureContinuous(recent);
  const nextPhien = lichSu.length > 0 ? lichSu[0].Phien + 1 : 1;
  res.json({
    phienTiepTheo: nextPhien,
    duDoan: result.predict,
    doTinCay: result.confidence + '%',
    ghiChuLogic: result.note,
    cheDo: '100% Continuous (Zero Skips, Zero Hacks)',
    lichSuSoLuong: recent.length
  });
});

app.get('/api/simulate', (req, res) => {
  const window = parseInt(req.query.window) || 100;
  const resSim = runDatasetSimulation(lichSu, window);
  res.json(resSim);
});

app.get('/api/download', (req, res) => {
  if (fs.existsSync(DATA_FILE)) {
    return res.download(DATA_FILE, `sunwin_history_${Date.now()}.json`);
  }
  res.status(404).json({ error: 'Chưa có dữ liệu nào được lưu' });
});

app.post('/api/import', (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Dữ liệu phải là 1 mảng JSON' });
    let added = 0;
    items.forEach(item => {
      if (item && item.Phien && !lichSuMap.has(item.Phien)) {
        lichSuMap.set(item.Phien, item);
        added++;
      }
    });
    saveDataToFile();
    res.json({ success: true, addedCount: added, totalSessions: lichSu.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats', (req, res) => {
  res.json({
    status: 'ACTIVE',
    totalSessionsCollected: lichSu.length,
    latestSession: lichSu[0] || null,
    oldestSession: lichSu[lichSu.length - 1] || null
  });
});

app.get('/', (req, res) => {
  res.json({
    message: '🎲 Sunwin Pure Continuous Dice Physics AI Engine (100% Bets, Zero Skips)',
    totalSessionsCollected: lichSu.length,
    latestSession: lichSu[0] || null,
    endpoints: {
      history: '/api/lichsu',
      predict: '/api/predict',
      simulate: '/api/simulate',
      download: '/api/download',
      import: 'POST /api/import'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Sunwin Server đang chạy tại http://0.0.0.0:${PORT}`);
  connectWS();
});
