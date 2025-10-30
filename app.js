// app.js
// Single-file Express backend + frontend for Smart Chair IoT
// Run: npm init -y
//      npm install express cors
// Then: node app.js
//
// The server:
//  - serves a single-page dashboard at "/"
//  - accepts POST /update (JSON) from ESP32
//  - exposes GET /data (latest) and GET /history (all)
//  - writes history to data.json in the same folder

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' })); // parse application/json

// load or init history
let history = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    history = raw ? JSON.parse(raw) : [];
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2));
  }
} catch (err) {
  console.error('Failed reading data file', err);
  history = [];
}

// latest snapshot convenience
let latest = history.length ? history[history.length - 1] : {
  posture: "Unknown",
  distance: 0,
  sitting_time: 0,
  timestamp: null
};

// helper to persist
function appendAndPersist(entry) {
  history.push(entry);
  latest = entry;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('Failed writing data file', err);
  }
}

// Serve dashboard (single HTML page embedded here)
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Smart Chair Dashboard</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body{font-family:Inter,Arial,Helvetica,sans-serif;background:#f4f7fb;color:#222;margin:0;padding:24px;display:flex;flex-direction:column;align-items:center;}
    .wrap{max-width:980px;width:100%;}
    header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
    h1{font-size:20px;margin:0;}
    .alert-popup{position:fixed;top:20px;right:20px;background:#ff4444;color:white;padding:15px 40px 15px 15px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);display:none;z-index:1000;}
    .alert-popup .close{position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:20px;}
    .grid{display:flex;flex-wrap:wrap;gap:12px;}
    .card{background:#fff;padding:18px;border-radius:12px;box-shadow:0 6px 18px rgba(20,30,60,0.06);min-width:200px;flex:1;}
    .value{font-size:28px;font-weight:600;margin-top:8px;}
    .good{color:green;text-shadow:0 1px 0 rgba(0,0,0,0.03)}
    .bad{color:#d33}
    #controls{display:flex;gap:10px;align-items:center}
    button{padding:8px 12px;border-radius:8px;border:0;background:#2b7cff;color:white;cursor:pointer}
    small{color:#666}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{padding:8px;border-bottom:1px solid #eee;text-align:left;font-size:13px}
    canvas{max-width:100%;}
    footer{margin-top:18px;color:#666;font-size:13px}
  </style>
</head>
<body>
  <div id="alert" class="alert-popup">
    You've been sitting for too long! Take a break.
    <span class="close">&times;</span>
  </div>
  <div class="wrap">
    <header>
      <h1>🪑 Smart Chair — Live Dashboard</h1>
      <div id="controls">
        <button id="btnRefresh">Refresh</button>
        <a id="download" href="/download.csv"><button>Download CSV</button></a>
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <small>Posture</small>
        <div id="posture" class="value">—</div>
      </div>
      <div class="card">
        <small>Distance (cm)</small>
        <div id="distance" class="value">—</div>
      </div>
      <div class="card">
        <small>Sitting Time (min)</small>
        <div id="time" class="value">—</div>
      </div>
      <div class="card">
        <small>Last Update</small>
        <div id="last" class="value">—</div>
      </div>
    </div>

    <div style="margin-top:18px;background:#fff;padding:14px;border-radius:12px;box-shadow:0 6px 18px rgba(20,30,60,0.04)">
      <canvas id="chart" height="120"></canvas>
      <table id="historyTable">
        <thead><tr><th>Time</th><th>Posture</th><th>Distance (cm)</th><th>Sitting (min)</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>

    <footer>
      Data auto-refreshes every 2s. ESP32 must POST JSON to <code>/update</code> on this host.
    </footer>
  </div>

  <script>
    // small chart using canvas (no libs)
    const ctx = document.getElementById('chart').getContext('2d');

    function drawChart(labels, values) {
      // simple line chart draw
      const c = document.getElementById('chart');
      const w = c.width = c.clientWidth;
      const h = c.height = 140;
      ctx.clearRect(0,0,w,h);
      // background grid
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 1;
      for (let y=0;y<=4;y++){
        ctx.beginPath();
        ctx.moveTo(0,h * y / 4);
        ctx.lineTo(w, h * y / 4);
        ctx.stroke();
      }
      if (!values.length) return;
      const max = Math.max(...values) || 1;
      const min = Math.min(...values);
      const range = (max - min) || 1;
      ctx.strokeStyle = '#2b7cff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = (i / (values.length - 1 || 1)) * (w - 20) + 10;
        const y = h - ((v - min) / range) * (h - 20) - 10;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // points
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#2b7cff';
      for (let i=0;i<values.length;i++){
        const v = values[i];
        const x = (i / (values.length - 1 || 1)) * (w - 20) + 10;
        const y = h - ((v - min) / range) * (h - 20) - 10;
        ctx.beginPath(); ctx.arc(x,y,3,0,2*Math.PI); ctx.fill(); ctx.stroke();
      }
    }

    async function fetchLatest() {
      try {
        const res = await fetch('/data');
        if (!res.ok) throw new Error('bad response');
        const data = await res.json();
        document.getElementById('posture').innerText = data.posture || '—';
        document.getElementById('distance').innerText = (data.distance != null) ? data.distance : '—';
        document.getElementById('time').innerText = (data.sitting_time != null) ? data.sitting_time : '—';
        document.getElementById('last').innerText = data.timestamp || '—';
        document.getElementById('posture').className = data.posture === 'Bad' ? 'value bad' : 'value good';
      } catch (err) {
        console.error(err);
      }
    }

    async function fetchHistoryAndRender() {
      try {
        const res = await fetch('/history');
        if (!res.ok) return;
        const arr = await res.json();
        // Limit to last 30 entries
        const last = arr.slice(-30);
        const tbody = document.querySelector('#historyTable tbody');
        tbody.innerHTML = '';
        const labels = [];
        const distances = [];
        last.forEach(e => {
          const tr = document.createElement('tr');
          const ttime = e.timestamp || '';
          tr.innerHTML = '<td>' + ttime + '</td>' +
                         '<td>' + (e.posture || '') + '</td>' +
                         '<td>' + (e.distance != null ? e.distance : '') + '</td>' +
                         '<td>' + (e.sitting_time != null ? e.sitting_time : '') + '</td>';
          tbody.appendChild(tr);
          labels.push(ttime);
          distances.push(e.distance || 0);
        });
        drawChart(labels, distances);
      } catch (err) {
        console.error(err);
      }
    }

    document.getElementById('btnRefresh').addEventListener('click', () => {
      fetchLatest();
      fetchHistoryAndRender();
    });

    // poll every 2s
    setInterval(() => {
      fetchLatest();
      fetchHistoryAndRender();
    }, 2000);

    // initial
    fetchLatest();
    fetchHistoryAndRender();

    // Alert popup functionality
    const alertPopup = document.getElementById('alert');
    alertPopup.querySelector('.close').addEventListener('click', () => {
      alertPopup.style.display = 'none';
    });

    // Check for alerts
    async function checkAlerts() {
      try {
        const res = await fetch('/alert');
        if (!res.ok) return;
        const data = await res.json();
        if (data.show) {
          alertPopup.style.display = 'block';
        }
      } catch (err) {
        console.error('Alert check failed:', err);
      }
    }

    // Check for alerts every 5 seconds
    setInterval(checkAlerts, 5000);
  </script>
</body>
</html>`);
});

// Accept POST from ESP device
// Expected JSON body: { posture: "Good"|"Bad", distance: <number>, sitting_time: <number> }
// Server adds timestamp and persists
app.post('/update', (req, res) => {
  try {
    const body = req.body || {};
    // basic validation + sanitization
    const posture = typeof body.posture === 'string' ? body.posture : String(body.posture || 'Unknown');
    const distance = Number.isFinite(Number(body.distance)) ? Number(body.distance) : 0;
    const sitting_time = Number.isFinite(Number(body.sitting_time)) ? Number(body.sitting_time) : 0;
    const timestamp = new Date().toISOString(); // ISO timestamp

    const entry = { posture, distance, sitting_time, timestamp };

    appendAndPersist(entry);

    // respond
    res.json({ status: 'ok', received: entry });
    console.log(`[${timestamp}] update:`, entry);
  } catch (err) {
    console.error('update error', err);
    res.status(500).json({ status: 'error', error: String(err) });
  }
});

// Return latest snapshot
app.get('/data', (req, res) => {
  res.json(latest);
});

// Return full history (can be large)
app.get('/history', (req, res) => {
  res.json(history);
});

// Provide CSV download of history
// Handle alert notifications
app.post('/alert', (req, res) => {
  res.json({ status: 'ok', received: true });
});

// Check alert status
app.get('/alert', (req, res) => {
  res.json({ show: true });
});

app.get('/download.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="smart-chair-history.csv"');
  // Header
  res.write('timestamp,posture,distance,sitting_time\n');
  for (const e of history) {
    const row = [
      e.timestamp || '',
      (''+e.posture).replace(/,/g,''),
      (e.distance != null ? e.distance : ''),
      (e.sitting_time != null ? e.sitting_time : '')
    ].join(',');
    res.write(row + '\n');
  }
  res.end();
});

app.listen(PORT, () => {
  console.log(`Smart Chair server listening on http://0.0.0.0:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
