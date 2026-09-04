const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next(); });

const PORT = process.env.PORT || 3001;

// Hỗ trợ Railway Volume
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

// Khôi phục dữ liệu
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
  } catch (e) {
    console.error('[❌] Lỗi đọc file data:', e.message);
  }
}

function saveDataToFile() {
  try {
    syncArrayFromMap();
    fs.writeFileSync(DATA_FILE, JSON.stringify(lichSu, null, 2), 'utf-8');
  } catch (e) {
    console.error('[❌] Lỗi ghi file data:', e.message);
  }
}

function syncArrayFromMap() {
  lichSu = Array.from(lichSuMap.values()).sort((a, b) => b.Phien - a.Phien);
}

loadDataFromFile();

// ===== ADAPTIVE STREAK-CAPPER PREDICTION ENGINE =====
// Thuật toán kiểm soát chuỗi sai tối đa 1, 2 hoặc 3 phiên
function predictNextSession(historyData, maxLossCap = 3, pastLossStreak = 0) {
  if (historyData.length < 10) return { predict: 'Tài', confidence: 50, note: 'Khởi tạo' };

  // Dữ liệu sắp xếp từ quá khứ đến hiện tại
  const chronological = [...historyData].sort((a, b) => a.Phien - b.Phien);
  const h = chronological.map(x => x.Ket_qua);
  const n = h.length;
  const last = h[n - 1];

  // Nếu quá chuỗi sai cho phép -> Tạm dừng ngắt chuỗi sai
  if (pastLossStreak >= maxLossCap) {
    return { predict: 'PAUSE', confidence: 0, note: `Tạm dừng ngắt chuỗi sai (Đã đạt max ${maxLossCap} sai)` };
  }

  let predict = last;
  let note = '';

  if (pastLossStreak === 0) {
    // Tay 1: Base Ensemble Pattern (Bệt -> 1-1 -> KNN-4)
    let streak = 1;
    for (let j = n - 2; j >= 0; j--) {
      if (h[j] === last) streak++;
      else break;
    }
    let pingpong = (h[n-1] !== h[n-2] && h[n-2] !== h[n-3] && h[n-3] !== h[n-4]);

    if (streak >= 3) {
      predict = last;
      note = `Cầu Bệt (${streak} phiên)`;
    } else if (pingpong) {
      predict = last === 'Tài' ? 'Xỉu' : 'Tài';
      note = 'Cầu 1-1';
    } else {
      const pat = h.slice(n - 4).join('');
      let tM = 0, xM = 0;
      for (let j = 4; j < n - 1; j++) {
        if (h.slice(j - 4, j).join('') === pat) {
          if (h[j] === 'Tài') tM++;
          else xM++;
        }
      }
      if (tM > xM) { predict = 'Tài'; note = 'KNN Matching (Tài)'; }
      else if (xM > tM) { predict = 'Xỉu'; note = 'KNN Matching (Xỉu)'; }
      else { predict = last; note = 'Mặc định'; }
    }
  } else if (pastLossStreak === 1) {
    // Tay 2 (Vừa thua tay 1): Follow Winner
    predict = last;
    note = 'Adaptive Follow-Winner (Khắc phục tay sai 1)';
  } else if (pastLossStreak === 2) {
    // Tay 3 (Vừa thua tay 2): Counter-Shift
    predict = last === 'Tài' ? 'Xỉu' : 'Tài';
    note = 'Adaptive Counter-Shift (Khắc phục tay sai 2)';
  }

  return { predict, confidence: 75, note };
}

// SIMULATOR TRÊN TOÀN BỘ BỘ DỮ LIỆU KHI CÓ YÊU CẦU
function runDatasetSimulation(dataset, windowSize = 100, maxLossCap = 3) {
  const sorted = [...dataset].sort((a, b) => a.Phien - b.Phien);
  let totalBets = 0;
  let correctBets = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;
  let streakCounts = {};
  let isPaused = false;

  for (let i = windowSize; i < sorted.length; i++) {
    const history = sorted.slice(i - windowSize, i);
    const actual = sorted[i].Ket_qua;
    const h = history.map(x => x.Ket_qua);
    const last = h[h.length - 1];

    if (isPaused) {
      isPaused = false;
      currentLossStreak = 0;
      continue;
    }

    if (currentLossStreak >= maxLossCap) {
      isPaused = true;
      continue;
    }

    const pObj = predictNextSession(history, maxLossCap, currentLossStreak);
    const predict = pObj.predict;

    if (predict === 'PAUSE') {
      isPaused = true;
      continue;
    }

    totalBets++;
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
    maxLossCap,
    totalSessions: sorted.length - windowSize,
    totalBets,
    correctBets,
    accuracy: totalBets > 0 ? ((correctBets / totalBets) * 100).toFixed(2) + '%' : '0%',
    maxLossStreak,
    streakCounts
  };
}

// ===== WEBSOCKET CONNECT =====
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

// API Dự đoán phiên tiếp theo với thuộc tính maxLossCap (mặc định = 3)
app.get('/api/predict', (req, res) => {
  const maxLossCap = parseInt(req.query.cap) || 3;
  const pastLossStreak = parseInt(req.query.lossStreak) || 0;
  const windowSize = parseInt(req.query.window) || 100;
  const recent = lichSu.slice(0, windowSize);
  const result = predictNextSession(recent, maxLossCap, pastLossStreak);
  const nextPhien = lichSu.length > 0 ? lichSu[0].Phien + 1 : 1;
  res.json({
    phienTiepTheo: nextPhien,
    duDoan: result.predict,
    ghiChu: result.note,
    maxLossStreakCap: maxLossCap,
    lichSuSoLuong: recent.length
  });
});

// API Chạy mô phỏng kiểm tra thuật toán trên toàn bộ dữ liệu hiện có
app.get('/api/simulate', (req, res) => {
  const cap = parseInt(req.query.cap) || 3;
  const window = parseInt(req.query.window) || 100;
  const resSim = runDatasetSimulation(lichSu, window, cap);
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
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Dữ liệu gửi lên phải là 1 mảng JSON' });
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
    message: '🎲 Sunwin Data Collector & Adaptive Streak-Capper AI',
    totalSessionsCollected: lichSu.length,
    latestSession: lichSu[0] || null,
    endpoints: {
      history: '/api/lichsu',
      predict: '/api/predict?cap=3&lossStreak=0',
      simulate: '/api/simulate?cap=3&window=100',
      download: '/api/download',
      import: 'POST /api/import'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Sunwin Server đang chạy tại http://0.0.0.0:${PORT}`);
  connectWS();
});
