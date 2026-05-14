/**
 * SmartGuard Dashboard — app.js
 * Real-time IoT appliance health monitoring
 *
 * Modes:
 *  1. LIVE mode — connected to Firebase Realtime Database
 *  2. DEMO mode — generates synthetic data locally (no Firebase needed)
 *
 * Architecture:
 *  - FirebaseManager: handles connection, real-time listeners
 *  - Classifier: mirrors TinyML model output format
 *  - ChartManager: manages Chart.js current draw visualization
 *  - AlertsManager: maintains alert history feed
 *  - UIManager: drives all DOM updates
 *  - DemoEngine: generates realistic synthetic sensor data
 */

'use strict';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const DEMO_INTERVAL_MS   = 2000;
const CHART_MAX_POINTS   = 30;
const WARN_THRESHOLD     = 3.2;   // Amps
const CRIT_THRESHOLD     = 4.2;   // Amps
const MAX_ALERT_HISTORY  = 50;

// ─────────────────────────────────────────────
// APP STATE
// ─────────────────────────────────────────────
const state = {
  mode:         'demo',      // 'demo' | 'live'
  firebaseApp:  null,
  database:     null,
  isConnected:  false,
  isTamper:     false,
  isLockedOut:  false,
  readingCount: 0,
  alertCount:   0,
  startTime:    Date.now(),
  lastReading:  null,
  demoInterval: null,
  chartData: {
    labels:     [],
    current:    [],
    warnLine:   [],
    critLine:   [],
  },
  alerts: [],
};

// ─────────────────────────────────────────────
// DEMO ENGINE — synthetic realistic data
// ─────────────────────────────────────────────
const DemoEngine = (() => {
  let baseLoad       = 1.8;   // simulated idle current
  let trend          = 0;
  let anomalyPhase   = false;
  let anomalyCounter = 0;

  function nextReading() {
    // Slowly drift base load
    trend += (Math.random() - 0.5) * 0.05;
    trend  = Math.max(-0.5, Math.min(0.5, trend));
    baseLoad = Math.max(0.5, Math.min(4.8, baseLoad + trend * 0.1));

    // Occasional anomaly burst (15% chance per reading)
    if (!anomalyPhase && Math.random() < 0.15) {
      anomalyPhase   = true;
      anomalyCounter = Math.floor(Math.random() * 4) + 2;
    }
    if (anomalyPhase) {
      anomalyCounter--;
      if (anomalyCounter <= 0) anomalyPhase = false;
    }

    const current = anomalyPhase
      ? baseLoad + 1.5 + Math.random() * 1.0
      : baseLoad + (Math.random() - 0.5) * 0.4;

    const acoustic = anomalyPhase && Math.random() < 0.5;
    const tamper   = false; // manual via button only

    return {
      currentAmps:   Math.max(0, Math.min(5, current)),
      acoustic,
      tamper,
      timestamp:     Date.now().toString(),
    };
  }

  return { nextReading };
})();

// ─────────────────────────────────────────────
// CLASSIFIER (mirrors TinyML Edge Impulse output)
// ─────────────────────────────────────────────
const Classifier = {
  classify(reading) {
    const { currentAmps, acoustic, tamper } = reading;

    if (tamper || state.isLockedOut) {
      return { label: 'TAMPER', confidence: 0.99, cssClass: 'tamper' };
    }
    if (acoustic && currentAmps >= WARN_THRESHOLD) {
      const conf = 0.91 + Math.random() * 0.06;
      return { label: 'Critical', confidence: conf, cssClass: 'critical' };
    }
    if (currentAmps >= CRIT_THRESHOLD) {
      const conf = 0.88 + Math.random() * 0.08;
      return { label: 'Critical', confidence: conf, cssClass: 'critical' };
    }
    if (acoustic) {
      const conf = 0.84 + Math.random() * 0.06;
      return { label: 'Warning', confidence: conf, cssClass: 'warning' };
    }
    if (currentAmps >= WARN_THRESHOLD) {
      const conf = 0.82 + Math.random() * 0.07;
      return { label: 'Warning', confidence: conf, cssClass: 'warning' };
    }
    const conf = 0.84 + Math.random() * 0.12;
    return { label: 'Healthy', confidence: conf, cssClass: 'healthy' };
  },

  icon(label) {
    const icons = {
      'Healthy':  '✅',
      'Warning':  '⚠️',
      'Critical': '🔴',
      'TAMPER':   '🔒',
    };
    return icons[label] || '❓';
  }
};

// ─────────────────────────────────────────────
// CHART MANAGER
// ─────────────────────────────────────────────
const ChartManager = (() => {
  let chart = null;

  function init() {
    const ctx = document.getElementById('currentChart').getContext('2d');

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0,   'rgba(59,130,246,0.15)');
    gradient.addColorStop(0.6, 'rgba(59,130,246,0.02)');
    gradient.addColorStop(1,   'rgba(59,130,246,0)');

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Current Draw (A)',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: gradient,
            borderWidth: 2.5,
            pointRadius: 3,
            pointBackgroundColor: '#3b82f6',
            pointBorderWidth: 0,
            fill: true,
            tension: 0.4,
          },
          {
            label: 'Warn Threshold',
            data: [],
            borderColor: 'rgba(246,173,85,0.6)',
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
          {
            label: 'Critical Threshold',
            data: [],
            borderColor: 'rgba(252,129,129,0.6)',
            borderWidth: 1.5,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400, easing: 'easeInOutQuart' },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(255,255,255,0.95)',
            borderColor: 'rgba(0,0,0,0.05)',
            borderWidth: 1,
            titleColor: '#475569',
            bodyColor: '#0f172a',
            padding: 10,
            callbacks: {
              label: ctx => {
                if (ctx.datasetIndex === 0) return ` Current: ${ctx.raw.toFixed(2)} A`;
                if (ctx.datasetIndex === 1) return ` Warn: ${ctx.raw} A`;
                return ` Critical: ${ctx.raw} A`;
              }
            }
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false },
            ticks: { color: '#64748b', font: { size: 10, family: 'JetBrains Mono' }, maxTicksLimit: 8 },
          },
          y: {
            min: 0, max: 5.5,
            grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false },
            ticks: {
              color: '#64748b',
              font: { size: 10, family: 'JetBrains Mono' },
              callback: v => v.toFixed(1) + ' A',
            },
          },
        },
      },
    });
  }

  function push(timeLabel, currentAmps) {
    const d = chart.data;
    d.labels.push(timeLabel);
    d.datasets[0].data.push(parseFloat(currentAmps.toFixed(3)));
    d.datasets[1].data.push(WARN_THRESHOLD);
    d.datasets[2].data.push(CRIT_THRESHOLD);

    // Sliding window
    if (d.labels.length > CHART_MAX_POINTS) {
      d.labels.shift();
      d.datasets.forEach(ds => ds.data.shift());
    }
    chart.update();
  }

  return { init, push };
})();

// ─────────────────────────────────────────────
// ALERTS MANAGER
// ─────────────────────────────────────────────
const AlertsManager = (() => {
  function add(result, reading) {
    if (result.label === 'Healthy') return;  // Don't log healthy readings

    state.alerts.unshift({
      id:          Date.now(),
      label:       result.label,
      cssClass:    result.cssClass,
      confidence:  result.confidence,
      current:     reading.currentAmps,
      acoustic:    reading.acoustic,
      tamper:      reading.tamper,
      time:        new Date(),
    });

    if (state.alerts.length > MAX_ALERT_HISTORY) {
      state.alerts.pop();
    }

    state.alertCount++;
    render();
    UIManager.updateAlertBadge(state.alertCount);
  }

  function render() {
    const feed = document.getElementById('alertsFeed');
    if (!feed) return;

    if (state.alerts.length === 0) {
      feed.innerHTML = `
        <div class="no-alerts">
          <span>🛡️</span>
          No anomalies detected. System is healthy.
        </div>`;
      return;
    }

    feed.innerHTML = state.alerts.map(a => `
      <div class="alert-item ${a.cssClass}">
        <div class="alert-icon">${Classifier.icon(a.label)}</div>
        <div class="alert-content">
          <div class="alert-type">${a.label}${a.tamper ? ' — Device Lockout Active' : ''}</div>
          <div class="alert-detail">
            ${a.current.toFixed(2)}A · ${(a.confidence * 100).toFixed(1)}% confidence
            ${a.acoustic ? ' · Acoustic event' : ''}
          </div>
        </div>
        <div class="alert-time">${formatTime(a.time)}</div>
      </div>
    `).join('');
  }

  function clear() {
    state.alerts   = [];
    state.alertCount = 0;
    UIManager.updateAlertBadge(0);
    render();
  }

  return { add, render, clear };
})();

// ─────────────────────────────────────────────
// UI MANAGER
// ─────────────────────────────────────────────
const UIManager = (() => {
  let prevCssClass = 'healthy';
  let uptimeInterval = null;

  function init() {
    startUptimeCounter();
    updateClock();
    setInterval(updateClock, 1000);
  }

  function updateStatus(result, reading) {
    // ── Confidence ring ──
    const pct      = Math.round(result.confidence * 100);
    const ringFill = document.getElementById('ringFill');
    const ringPct  = document.getElementById('ringPct');
    const ringColor = {
      healthy:  '#68d391',
      warning:  '#f6ad55',
      critical: '#fc8181',
      tamper:   '#b794f4',
    }[result.cssClass] || '#68d391';

    const circumference = 440;
    const offset = circumference - (pct / 100) * circumference;
    ringFill.style.strokeDashoffset = offset;
    ringFill.style.stroke           = ringColor;
    ringPct.textContent             = pct + '%';
    ringPct.style.color             = ringColor;

    // ── Status badge ──
    const badge = document.getElementById('statusBadge');
    badge.className = `status-badge ${result.cssClass}`;
    badge.innerHTML = `${Classifier.icon(result.label)} ${result.label}`;

    // ── Stat: Current ──
    document.getElementById('statCurrent').textContent = reading.currentAmps.toFixed(2) + ' A';
    document.getElementById('statReadings').textContent = state.readingCount;

    // ── Acoustic / Tamper indicators ──
    const acousticEl = document.getElementById('statAcoustic');
    if (acousticEl) {
      acousticEl.textContent = reading.acoustic ? '⚡ Event' : '— None';
      acousticEl.style.color  = reading.acoustic ? 'var(--warn-color)' : 'var(--text-dim)';
    }

    // ── Tamper lockout banner ──
    if (result.label === 'TAMPER' || state.isLockedOut) {
      showTamperBanner();
    }

    prevCssClass = result.cssClass;
  }

  function showTamperBanner() {
    const banner = document.getElementById('tamperBanner');
    if (banner) banner.classList.add('active');
  }

  function hideTamperBanner() {
    const banner = document.getElementById('tamperBanner');
    if (banner) banner.classList.remove('active');
  }

  function setConnection(connected) {
    const badge = document.getElementById('connBadge');
    const text  = document.getElementById('connText');
    state.isConnected = connected;
    badge.className = `connection-badge ${connected ? 'connected' : 'disconnected'}`;
    text.textContent = connected ? 'Firebase Live' : 'Demo Mode';
  }

  function updateAlertBadge(count) {
    const el = document.getElementById('alertBadge');
    if (!el) return;
    el.textContent = count;
    el.style.display = count > 0 ? 'inline' : 'none';
  }

  function updateClock() {
    const el = document.getElementById('topbarTime');
    if (el) el.textContent = new Date().toLocaleTimeString();
  }

  function startUptimeCounter() {
    const el = document.getElementById('uptimePill');
    if (!el) return;
    uptimeInterval = setInterval(() => {
      const secs = Math.floor((Date.now() - state.startTime) / 1000);
      const h    = String(Math.floor(secs / 3600)).padStart(2, '0');
      const m    = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
      const s    = String(secs % 60).padStart(2, '0');
      el.textContent = `↑ ${h}:${m}:${s}`;
    }, 1000);
  }

  return { init, updateStatus, setConnection, updateAlertBadge, showTamperBanner, hideTamperBanner };
})();

// ─────────────────────────────────────────────
// FIREBASE MANAGER
// ─────────────────────────────────────────────
const FirebaseManager = {
  connect(projectIdOrUrl, secret) {
    if (!projectIdOrUrl) return;

    try {
      let dbUrl = projectIdOrUrl;
      // If they only pasted the ID, format it. If they pasted the full https:// link, use it directly.
      if (!dbUrl.startsWith('http')) {
        dbUrl = `https://${projectIdOrUrl}-default-rtdb.firebaseio.com`;
      }

      const firebaseConfig = { databaseURL: dbUrl };

      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }

      state.database = firebase.database();

      // Test connection
      state.database.ref('.info/connected').on('value', snap => {
        const connected = snap.val() === true;
        UIManager.setConnection(connected);
        if (connected) {
          state.mode = 'live';
          stopDemo();
          startLiveListeners(secret);
        } else {
          state.mode = 'demo';
          startDemo();
        }
      });

    } catch (err) {
      console.error('[Firebase] Init error:', err);
      showError('Firebase connection failed. Check your project ID. Running in Demo Mode.');
      startDemo();
    }
  },

  disconnect() {
    if (state.database) {
      state.database.ref('readings').off();
      state.database.ref('alerts').off();
      state.database.ref('device/status').off();
    }
  }
};

function startLiveListeners(secret) {
  if (!state.database) return;

  // Listen to latest reading
  state.database.ref('readings').limitToLast(1).on('child_added', snap => {
    const data = snap.val();
    if (!data) return;
    processReading({
      currentAmps: parseFloat(data.currentAmps) || 0,
      acoustic:    data.acoustic   || false,
      tamper:      data.tamper     || false,
      timestamp:   data.timestamp,
    });
  });

  // Listen to device status
  state.database.ref('device/status').on('value', snap => {
    const status = snap.val();
    if (status && status.lockedOut) {
      state.isLockedOut = true;
      UIManager.showTamperBanner();
    }
  });
}

// ─────────────────────────────────────────────
// DEMO MODE
// ─────────────────────────────────────────────
function startDemo() {
  if (state.demoInterval) return;
  UIManager.setConnection(false);

  state.demoInterval = setInterval(() => {
    const reading = DemoEngine.nextReading();
    processReading(reading);
  }, DEMO_INTERVAL_MS);

  // Immediate first reading
  processReading(DemoEngine.nextReading());
}

function stopDemo() {
  if (state.demoInterval) {
    clearInterval(state.demoInterval);
    state.demoInterval = null;
  }
}

// ─────────────────────────────────────────────
// CORE PROCESSING PIPELINE
// ─────────────────────────────────────────────
function processReading(reading) {
  state.readingCount++;
  state.lastReading = reading;

  // Handle tamper state
  if (reading.tamper) {
    state.isTamper   = true;
    state.isLockedOut = true;
  }

  // Classify
  const result = Classifier.classify(reading);

  // Update chart
  const timeLabel = formatTime(new Date());
  ChartManager.push(timeLabel, reading.currentAmps);

  // Update UI
  UIManager.updateStatus(result, reading);

  // Log alert if anomaly
  AlertsManager.add(result, reading);

  // Pulse on anomaly
  if (result.cssClass !== 'healthy') {
    pulseCard();
  }
}

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function pulseCard() {
  const card = document.querySelector('.health-card');
  if (!card) return;
  card.style.transition = 'border-color 0.1s ease';
  card.style.borderColor = 'rgba(252,129,129,0.5)';
  setTimeout(() => { card.style.borderColor = ''; }, 400);
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  }
}

// ─────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  ChartManager.init();
  UIManager.init();
  AlertsManager.render();

  // Start demo mode immediately
  startDemo();

  // Connect button
  const btnConnect = document.getElementById('btnConnect');
  btnConnect?.addEventListener('click', () => {
    const projectId = document.getElementById('fbProjectId').value.trim();
    const secret    = document.getElementById('fbSecret').value.trim();

    if (!projectId) {
      showError('Please enter your Firebase Project ID.');
      return;
    }

    stopDemo();
    FirebaseManager.connect(projectId, secret);
  });

  // Clear alerts
  document.getElementById('btnClearAlerts')?.addEventListener('click', () => {
    AlertsManager.clear();
  });

  // Reset tamper
  document.getElementById('btnResetTamper')?.addEventListener('click', () => {
    state.isTamper    = false;
    state.isLockedOut  = false;
    UIManager.hideTamperBanner();

    // If live mode, update Firebase
    if (state.database) {
      state.database.ref('device/status/lockedOut').set(false);
      state.database.ref('device/status/tamper').set(false);
    }
  });

  // Simulate anomaly manually (for demo)
  document.getElementById('btnSimAnomaly')?.addEventListener('click', () => {
    processReading({ currentAmps: 4.5, acoustic: true, tamper: false, timestamp: Date.now().toString() });
  });

  // Simulate tamper manually (for demo)
  document.getElementById('btnSimTamper')?.addEventListener('click', () => {
    processReading({ currentAmps: 2.1, acoustic: false, tamper: true, timestamp: Date.now().toString() });
  });
});
