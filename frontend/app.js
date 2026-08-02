/* ── Theme ──────────────────────────────────────────────────────────── */
function getThemeColors() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
        gridColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        textColor: isDark ? '#64748b' : '#475569',
        green: isDark ? '#10b981' : '#059669',
        red: isDark ? '#f43f5e' : '#dc2626',
        accent: isDark ? '#6366f1' : '#4f46e5',
        accentLt: isDark ? '#818cf8' : '#6366f1',
        chartBorder: isDark ? '#0e1120' : '#ffffff',
        palette: ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#a855f7',
            '#ec4899', '#14b8a6', '#84cc16', '#fb923c', '#e879f9', '#38bdf8',
            '#4ade80', '#fbbf24', '#f87171', '#c084fc'],
    };
}

let C = getThemeColors();

Chart.defaults.color = C.textColor;
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.legend.labels.boxWidth = 11;
Chart.defaults.plugins.legend.labels.padding = 14;

const charts = {};
function killChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mf-theme', theme);
    const icon = theme === 'light' ? '☀️' : '🌙';
    document.querySelectorAll('.theme-toggle').forEach(b => b.textContent = icon);
    C = getThemeColors();
    Chart.defaults.color = C.textColor;
    if (appData) renderDashboard(appData);
}

// Init theme from localStorage
(function () {
    const saved = localStorage.getItem('mf-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    C = getThemeColors();
    Chart.defaults.color = C.textColor;
})();

/* ── Formatters ─────────────────────────────────────────────────────── */
function inr(n, decimals = 0) {
    if (n == null) return '—';
    const sign = n < 0 ? '-' : '';
    return sign + '₹' + Math.abs(n).toLocaleString('en-IN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function pct(n, dec = 2) {
    if (n == null) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(dec) + '%';
}

function lakh(n) {
    if (n == null) return '—';
    const a = Math.abs(n);
    if (a >= 1e7) return (n < 0 ? '-' : '') + '₹' + (a / 1e7).toFixed(2) + 'Cr';
    if (a >= 1e5) return (n < 0 ? '-' : '') + '₹' + (a / 1e5).toFixed(2) + 'L';
    if (a >= 1e3) return (n < 0 ? '-' : '') + '₹' + (a / 1e3).toFixed(1) + 'K';
    return inr(n);
}

function txnTypeClass(t) {
    const s = (t || '').toLowerCase();
    if (/switch.?in|purchase|sip|lump/.test(s)) return 'txn-buy';
    if (/switch.?out|redeem|withdraw/.test(s)) return 'txn-sell';
    if (/dividend|reinvest/.test(s)) return 'txn-div';
    return 'txn-other';
}

/* ── APP STATE ──────────────────────────────────────────────────────── */
let appData = null;
let pyodideWorker = null;
let pyodideReady = false;
let pyodideInitPromise = null;
let useLocalBackend = false; // true if running with FastAPI backend

/* ── DETECT MODE ───────────────────────────────────────────────────── */
async function detectMode() {
    const isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
    if (!isLocalhost) { useLocalBackend = false; return; }
    try {
        const res = await fetch('/api/upload', { method: 'OPTIONS' });
        if (res.ok || res.status === 405 || res.status === 422) useLocalBackend = true;
    } catch (e) {
        useLocalBackend = false;
    }
}

/* ── PYODIDE WORKER ─────────────────────────────────────────────────── */
function startPyodideWorker(onStageUpdate) {
    pyodideInitPromise = new Promise((resolve, reject) => {
        pyodideWorker = new Worker('pyodide-worker.js');
        const progressStages = { 1: 10, 2: 25, 3: 50, 4: 70, 5: 90, 6: 100 };

        pyodideWorker.onmessage = (e) => {
            const { type, stage, message } = e.data;
            if (type === 'progress') {
                if (onStageUpdate) onStageUpdate(progressStages[stage] || 0, message || '');
            } else if (type === 'ready') {
                pyodideReady = true;
                resolve();
            } else if (type === 'error') {
                reject(new Error(message));
            }
        };
        pyodideWorker.onerror = (err) => reject(new Error('Worker error: ' + err.message));
        pyodideWorker.postMessage({ type: 'init' });
    });
    return pyodideInitPromise;
}

function analyzeWithPyodide(pdfArrayBuffer, password) {
    return new Promise((resolve, reject) => {
        const handler = (e) => {
            const { type, data, message } = e.data;
            if (type === 'result') {
                pyodideWorker.removeEventListener('message', handler);
                resolve(data);
            } else if (type === 'error') {
                pyodideWorker.removeEventListener('message', handler);
                reject(new Error(message));
            }
        };
        pyodideWorker.addEventListener('message', handler);
        pyodideWorker.postMessage({ type: 'analyze', pdfBytes: pdfArrayBuffer, password });
    });
}

/* ── UPLOAD & INITIALIZATION ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
    const uploadScreen = document.getElementById('upload-screen');
    const dashScreen = document.getElementById('dashboard-screen');
    const form = document.getElementById('upload-form');
    const fileInput = document.getElementById('cas-file');
    const fileDrop = document.getElementById('file-zone');
    const fileLabel = document.getElementById('file-label');
    const passInput = document.getElementById('cas-password');
    const submitBtn = document.getElementById('submit-btn');
    const btnText = document.getElementById('btn-text');
    const btnLoader = document.getElementById('btn-loader');
    const errMsg = document.getElementById('upload-error');
    const resetBtn = document.getElementById('reset-btn');
    const pyodideStatusEl = document.getElementById('pyodide-status');

    // Show upload form immediately — no blocking
    await detectMode();

    if (!useLocalBackend) {
        // Begin Pyodide init silently in background
        startPyodideWorker((pct, msg) => {
            if (pyodideStatusEl) {
                pyodideStatusEl.textContent = pyodideReady ? '' : `⏳ Loading Python runtime… ${msg}`;
                if (pyodideReady) pyodideStatusEl.textContent = '';
            }
        }).then(() => {
            if (pyodideStatusEl) pyodideStatusEl.textContent = '';
        }).catch((err) => {
            console.error('Pyodide init failed:', err);
            if (pyodideStatusEl) pyodideStatusEl.textContent = '⚠ Python runtime failed to load. Try refreshing.';
        });
    }

    // Check for previous session
    try {
        const prev = await window.MFStorage.getLatestSnapshot();
        if (prev) {
            const prevBanner = document.getElementById('prev-session');
            const prevDate = document.getElementById('prev-session-date');
            const d = new Date(prev.timestamp);
            prevDate.textContent = 'Analyzed on ' + d.toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
            prevBanner.classList.remove('hidden');

            document.getElementById('load-prev-btn').addEventListener('click', () => {
                appData = prev.data;
                renderDashboard(appData);
                showSnapshotBadge(prev.timestamp);
                uploadScreen.classList.add('hidden');
                dashScreen.classList.remove('hidden');
                window.scrollTo(0, 0);
            });

            document.getElementById('dismiss-prev-btn').addEventListener('click', () => {
                prevBanner.classList.add('hidden');
            });
        }
    } catch (e) {
        console.warn('Could not load previous session:', e);
    }

    // File picker
    fileInput.addEventListener('change', () => {
        fileLabel.textContent = fileInput.files[0]?.name || 'Click to select or drag & drop your PDF';
    });
    fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('over'); });
    fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('over'));
    fileDrop.addEventListener('drop', e => {
        e.preventDefault(); fileDrop.classList.remove('over');
        if (e.dataTransfer.files[0]) {
            fileInput.files = e.dataTransfer.files;
            fileLabel.textContent = e.dataTransfer.files[0].name;
        }
    });

    // Form submit
    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!fileInput.files.length) return;
        errMsg.classList.add('hidden');
        submitBtn.disabled = true;
        btnText.textContent = 'Analyzing PDF…';
        btnLoader.classList.remove('hidden');

        try {
            let data;

            if (useLocalBackend) {
                // Use FastAPI backend (local dev mode)
                const fd = new FormData();
                fd.append('file', fileInput.files[0]);
                fd.append('password', passInput.value);
                const res = await fetch('/api/upload', { method: 'POST', body: fd });
                const json = await res.json();
                if (!res.ok) throw new Error(json.detail || 'Upload failed');
                data = json.data;
            } else {
                // Browser mode — use Pyodide + casparser
                if (!pyodideReady) {
                    btnText.textContent = 'Waiting for Python runtime…';
                    // Wait for Pyodide to finish loading
                    await pyodideInitPromise;
                }
                btnText.textContent = 'Analyzing PDF…';
                const arrayBuffer = await fileInput.files[0].arrayBuffer();
                data = await analyzeWithPyodide(arrayBuffer, passInput.value);
            }

            appData = data;
            renderDashboard(appData);

            // Save snapshot
            try {
                await window.MFStorage.saveSnapshot(data);
                showSnapshotBadge(new Date().toISOString());
            } catch (e) {
                console.warn('Could not save snapshot:', e);
            }

            uploadScreen.classList.add('hidden');
            dashScreen.classList.remove('hidden');
            window.scrollTo(0, 0);
        } catch (err) {
            console.error('CAS Analysis Error:', err);
            const errStack = err.stack || err.toString();
            errMsg.innerHTML = `
                <div class="error-box">
                    <div class="error-header">
                        <strong>⚠ ${escapeHTML(err.message || 'An unexpected error occurred during PDF parsing.')}</strong>
                    </div>
                    <details class="error-details">
                        <summary>View Debug Technical Details</summary>
                        <pre class="error-stack">${escapeHTML(errStack)}</pre>
                        <button type="button" class="btn-copy-error" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent).then(() => this.textContent = 'Copied!').catch(() => {})">Copy Error Log</button>
                    </details>
                </div>
            `;
            errMsg.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            btnText.textContent = 'Analyze My Portfolio';
            btnLoader.classList.add('hidden');
        }
    });

    // Reset
    resetBtn.addEventListener('click', () => {
        dashScreen.classList.add('hidden');
        uploadScreen.classList.remove('hidden');
        form.reset();
        fileLabel.textContent = 'Click to select or drag & drop your PDF';
        Object.keys(charts).forEach(killChart);
        appData = null;
    });

    // Modal close
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // Theme toggles
    const savedTheme = localStorage.getItem('mf-theme') || 'dark';
    const icon = savedTheme === 'light' ? '☀️' : '🌙';
    document.querySelectorAll('.theme-toggle').forEach(b => b.textContent = icon);

    document.querySelectorAll('.theme-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-theme') || 'dark';
            applyTheme(cur === 'dark' ? 'light' : 'dark');
        });
    });
});


/* ── SNAPSHOT BADGE ─────────────────────────────────────────────────── */
function showSnapshotBadge(timestamp) {
    const badge = document.getElementById('snapshot-badge');
    if (!badge) return;
    const d = new Date(timestamp);
    badge.textContent = '📁 ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    badge.title = 'Analyzed on ' + d.toLocaleString('en-IN');
    badge.classList.remove('hidden');
}


/* ── RENDER DASHBOARD ───────────────────────────────────────────────── */
function renderDashboard(d) {
    const s = d.summary;

    // KPI cards
    document.getElementById('k-invested').textContent = lakh(s.total_invested);
    document.getElementById('k-current').textContent = lakh(s.current_value);
    document.getElementById('k-withdrawn').textContent = lakh(s.total_withdrawn);
    document.getElementById('k-funds').textContent = s.num_funds;
    document.getElementById('k-years').textContent = s.num_years + ' FYs';

    const divEl = document.getElementById('k-dividends');
    divEl.textContent = lakh(s.total_dividends);
    divEl.className = 'kpi-val positive';

    const gainsEl = document.getElementById('k-gains');
    gainsEl.textContent = lakh(s.total_gains);
    gainsEl.className = 'kpi-val ' + (s.total_gains >= 0 ? 'positive' : 'negative');

    const absEl = document.getElementById('k-abs');
    absEl.textContent = pct(s.abs_return_pct) + ' absolute return';
    absEl.className = 'kpi-sub ' + (s.abs_return_pct >= 0 ? 'positive' : 'negative');

    const xirrEl = document.getElementById('k-xirr');
    xirrEl.textContent = s.overall_xirr != null ? pct(s.overall_xirr) : '—';
    xirrEl.className = 'kpi-val ' + (s.overall_xirr >= 0 ? 'positive' : 'negative');

    // SIP vs Lumpsum KPI
    const sipEl = document.getElementById('k-sip');
    const lumpEl = document.getElementById('k-lumpsum');
    if (sipEl) sipEl.textContent = lakh(s.total_sip || 0);
    if (lumpEl) lumpEl.textContent = lakh(s.total_lumpsum || 0);

    // Year table
    renderYearTable(d.year_data);

    // Charts
    renderYearlyBar(d.year_data);
    renderCumulative(d.year_data);
    renderAllocation(d.fund_data, s.current_value);
    renderFundXirr(d.fund_data);

    // Fund table
    renderFundTable(d.fund_data);

    // Insights tab
    renderInsights(d);
}


/* ── YEAR TABLE ─────────────────────────────────────────────────────────── */
function renderYearTable(yearData) {
    const tbody = document.getElementById('year-tbody');
    tbody.innerHTML = '';

    yearData.forEach(row => {
        const net = row.net;
        const tr = document.createElement('tr');
        tr.className = 'yr-row';
        tr.innerHTML = `
            <td class="yr-label">${row.fy}</td>
            <td class="num">${lakh(row.invested)}</td>
            <td class="num">${row.withdrawn > 0 ? lakh(row.withdrawn) : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td class="num">${row.dividends > 0 ? '<span class="positive">' + lakh(row.dividends) + '</span>' : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td class="num ${net >= 0 ? 'positive' : 'negative'}">${lakh(net)}</td>
            <td class="num">${lakh(row.cumulative_invested)}</td>
            <td class="num"><span class="pill nu">${row.txn_count} txns</span></td>
        `;
        tr.addEventListener('click', () => openModal(row));
        tbody.appendChild(tr);
    });
}


/* ── YEAR DRILL-DOWN MODAL ──────────────────────────────────────────── */
function openModal(row) {
    document.getElementById('modal-title').textContent = row.fy + ' — Transactions';

    const sumDiv = document.getElementById('modal-summary');
    sumDiv.innerHTML = `
        <div class="ms-chip"><span>Invested</span>${lakh(row.invested)}</div>
        <div class="ms-chip"><span>Withdrawn</span>${row.withdrawn > 0 ? lakh(row.withdrawn) : '—'}</div>
        <div class="ms-chip"><span>Dividends</span>${row.dividends > 0 ? '<b class="positive">' + lakh(row.dividends) + '</b>' : '—'}</div>
        <div class="ms-chip"><span>Net</span><b class="${row.net >= 0 ? 'positive' : 'negative'}">${lakh(row.net)}</b></div>
        <div class="ms-chip"><span>Transactions</span>${row.txn_count}</div>
    `;

    const thead = document.querySelector('#modal-table thead');
    thead.innerHTML = `
        <tr>
            <th>Date</th>
            <th>Fund</th>
            <th>Type</th>
            <th class="num">Amount</th>
            <th class="num">Units</th>
            <th class="num">NAV</th>
        </tr>
    `;

    const tbody = document.getElementById('modal-tbody');
    tbody.innerHTML = '';
    const txns = row.txns || [];

    if (txns.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:2rem">No transactions found.</td></tr>';
    } else {
        txns.forEach(t => {
            const pos = t.amount >= 0;
            const cls = txnTypeClass(t.type);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-feature-settings:'tnum'">${t.date}</td>
                <td style="max-width:260px;white-space:normal;line-height:1.35">${t.scheme}</td>
                <td><span class="txn-type ${cls}">${t.type || '—'}</span></td>
                <td class="num ${pos ? 'positive' : 'negative'}">${inr(Math.abs(t.amount))}</td>
                <td class="num">${t.units != null ? t.units.toFixed(4) : '—'}</td>
                <td class="num">${t.nav != null ? inr(t.nav, 4) : '—'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    document.getElementById('modal-overlay').classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.body.classList.remove('modal-open');
}


/* ── CHART 1: Yearly Grouped Bar ────────────────────────────────────── */
function renderYearlyBar(data) {
    killChart('yearly');
    const ctx = document.getElementById('ch-yearly').getContext('2d');
    charts['yearly'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(r => r.fy),
            datasets: [
                {
                    label: 'Invested',
                    data: data.map(r => r.invested),
                    backgroundColor: C.accent + 'bf',
                    borderRadius: 6,
                    borderSkipped: false,
                },
                {
                    label: 'Withdrawn',
                    data: data.map(r => r.withdrawn),
                    backgroundColor: C.red + '99',
                    borderRadius: 6,
                    borderSkipped: false,
                },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            onClick: (_, els) => {
                if (els.length && appData) openModal(appData.year_data[els[0].index]);
            },
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + lakh(c.parsed.y) } }
            },
            scales: {
                x: { grid: { color: C.gridColor } },
                y: { grid: { color: C.gridColor }, ticks: { callback: v => lakh(v) } }
            }
        }
    });
}


/* ── CHART 2: Cumulative invested line ──────────────────────────────── */
function renderCumulative(data) {
    killChart('cumul');
    const ctx = document.getElementById('ch-cumul').getContext('2d');
    charts['cumul'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(r => r.fy),
            datasets: [{
                label: 'Cumulative Invested',
                data: data.map(r => r.cumulative_invested),
                borderColor: C.green,
                backgroundColor: C.green + '1a',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: C.green,
                pointRadius: 4,
                pointHoverRadius: 7,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: c => ' Cumulative: ' + lakh(c.parsed.y) } }
            },
            scales: {
                x: { grid: { color: C.gridColor } },
                y: { grid: { color: C.gridColor }, ticks: { callback: v => lakh(v) } }
            }
        }
    });
}


/* ── CHART 3: Doughnut allocation ───────────────────────────────────── */
function renderAllocation(funds, portfolioTotal) {
    killChart('alloc');
    const top = funds.filter(f => f.current_value > 0).slice(0, 14);
    if (!top.length) return;
    const ctx = document.getElementById('ch-alloc').getContext('2d');
    const total = portfolioTotal || top.reduce((s, f) => s + f.current_value, 0);
    charts['alloc'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: top.map(f => f.name.length > 32 ? f.name.slice(0, 30) + '…' : f.name),
            datasets: [{
                data: top.map(f => f.current_value),
                backgroundColor: C.palette.slice(0, top.length),
                borderWidth: 2,
                borderColor: C.chartBorder,
                hoverOffset: 10,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, padding: 10, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: c => ' ' + lakh(c.parsed) + ' (' + (c.parsed / total * 100).toFixed(1) + '%)'
                    }
                }
            }
        }
    });
}


/* ── CHART 4: Fund XIRR horizontal bar ─────────────────────────────── */
function renderFundXirr(funds) {
    killChart('fxirr');
    const top = funds.filter(f => f.xirr != null).slice(0, 14);
    const ctx = document.getElementById('ch-fxirr').getContext('2d');
    charts['fxirr'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top.map(f => f.name.length > 32 ? f.name.slice(0, 30) + '…' : f.name),
            datasets: [{
                label: 'XIRR %',
                data: top.map(f => f.xirr),
                backgroundColor: top.map(f => f.xirr >= 0 ? C.green + 'bf' : C.red + 'a6'),
                borderRadius: 4,
                borderSkipped: false,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => ' XIRR: ' + pct(c.parsed.x) } }
            },
            scales: {
                x: { grid: { color: C.gridColor }, ticks: { callback: v => v + '%' } },
                y: { grid: { display: false }, ticks: { font: { size: 11 } } }
            }
        }
    });
}


/* ── FUND TABLE ─────────────────────────────────────────────────────── */
function renderFundTable(funds) {
    const tbody = document.getElementById('fund-tbody');
    tbody.innerHTML = '';

    funds.forEach(f => {
        const gainPos = f.gain >= 0;
        const xirrVal = f.xirr;
        const xirrCls = xirrVal == null ? 'nu' : xirrVal >= 0 ? 'up' : 'dn';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="fund-name">${f.name}</td>
            <td class="num">${lakh(f.invested)}</td>
            <td class="num">${lakh(f.current_value)}</td>
            <td class="num ${gainPos ? 'positive' : 'negative'}">${lakh(f.gain)}</td>
            <td class="num ${gainPos ? 'positive' : 'negative'}">${pct(f.abs_return)}</td>
            <td class="num"><span class="pill ${xirrCls}">${xirrVal != null ? pct(xirrVal) : '—'}</span></td>
        `;
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => openFundModal(f));
        tbody.appendChild(tr);
    });
}

/* ── FUND DRILL-DOWN MODAL ──────────────────────────────────────────── */
function openFundModal(f) {
    document.getElementById('modal-title').textContent = f.name + ' — Year on Year';

    const sumDiv = document.getElementById('modal-summary');
    sumDiv.innerHTML = `
        <div class="ms-chip"><span>Total Invested</span>${lakh(f.invested)}</div>
        <div class="ms-chip"><span>Current Value</span>${lakh(f.current_value)}</div>
        <div class="ms-chip"><span>Gain</span><b class="${f.gain >= 0 ? 'positive' : 'negative'}">${lakh(f.gain)}</b></div>
        <div class="ms-chip"><span>XIRR</span><b class="${f.xirr >= 0 ? 'positive' : 'negative'}">${f.xirr != null ? pct(f.xirr) : '—'}</b></div>
    `;

    const thead = document.querySelector('#modal-table thead');
    thead.innerHTML = `
        <tr>
            <th>FY</th>
            <th class="num">Invested</th>
            <th class="num">Withdrawn</th>
            <th class="num">Dividends</th>
            <th class="num">Net Flow</th>
        </tr>
    `;

    const tbody = document.getElementById('modal-tbody');
    tbody.innerHTML = '';
    const fyData = f.fy_data || [];

    if (fyData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:2rem">No year-on-year data found.</td></tr>';
    } else {
        fyData.forEach(y => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${y.fy}</td>
                <td class="num">${lakh(y.invested)}</td>
                <td class="num">${y.withdrawn > 0 ? lakh(y.withdrawn) : '—'}</td>
                <td class="num">${y.dividends > 0 ? '<span class="positive">' + lakh(y.dividends) + '</span>' : '—'}</td>
                <td class="num ${y.net >= 0 ? 'positive' : 'negative'}">${lakh(y.net)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    document.getElementById('modal-overlay').classList.remove('hidden');
    document.body.classList.add('modal-open');
}


/* ══════════════════════════════════════════════════════════════════════
   ██  INSIGHTS TAB
   ══════════════════════════════════════════════════════════════════════ */

function renderInsights(d) {
    const funds = d.fund_data || [];
    const yearData = d.year_data || [];
    const s = d.summary;

    renderTopPerformers(d.top_funds || funds);
    renderBottomPerformers(d.worst_funds || funds);
    renderConcentration(funds);
    renderAMCDiversification(funds);
    renderSIPvsLumpsum(yearData, s);
    renderFundCategories(funds, s);
    renderConsistency(yearData);
    renderDormant(funds);
    renderHealthCheck(funds, yearData, s);
}


/* ── TOP PERFORMERS ────────────────────────────────────────────────── */
function renderTopPerformers(topFunds) {
    const tbody = document.getElementById('top-performers');
    tbody.innerHTML = '';

    const top = (topFunds[0] && topFunds[0].xirr !== undefined)
        ? topFunds.slice(0, 5)
        : topFunds.filter(f => f.xirr != null && f.current_value > 0).sort((a, b) => b.xirr - a.xirr).slice(0, 5);

    if (!top.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem">No data available</td></tr>';
        return;
    }
    top.forEach((f, i) => {
        const g = f.current_value - f.invested;
        tbody.innerHTML += `<tr>
            <td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
            <td class="fund-name">${f.name}</td>
            <td class="num">${lakh(f.invested)}</td>
            <td class="num">${lakh(f.current_value)}</td>
            <td class="num positive">${lakh(g)}</td>
            <td class="num"><span class="pill up">${pct(f.xirr)}</span></td>
        </tr>`;
    });
}


/* ── BOTTOM PERFORMERS ──────────────────────────────────────────────── */
function renderBottomPerformers(worstFunds) {
    const tbody = document.getElementById('bottom-performers');
    tbody.innerHTML = '';

    const bottom = (worstFunds[0] && worstFunds[0].xirr !== undefined)
        ? worstFunds.slice(0, 5)
        : worstFunds.filter(f => f.xirr != null && f.current_value > 0).sort((a, b) => a.xirr - b.xirr).slice(0, 5);

    if (!bottom.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem">No underperformers detected</td></tr>';
        return;
    }
    bottom.forEach((f, i) => {
        const g = f.current_value - f.invested;
        const cls = f.xirr >= 0 ? 'up' : 'dn';
        tbody.innerHTML += `<tr>
            <td>${i + 1}</td>
            <td class="fund-name">${f.name}</td>
            <td class="num">${lakh(f.invested)}</td>
            <td class="num">${lakh(f.current_value)}</td>
            <td class="num ${g >= 0 ? 'positive' : 'negative'}">${lakh(g)}</td>
            <td class="num"><span class="pill ${cls}">${pct(f.xirr)}</span></td>
        </tr>`;
    });
}


/* ── CONCENTRATION RISK CHART ──────────────────────────────────────── */
function renderConcentration(funds) {
    killChart('concentration');
    const active = funds.filter(f => f.current_value > 0).sort((a, b) => b.current_value - a.current_value);
    if (!active.length) return;

    const total = active.reduce((s, f) => s + f.current_value, 0);
    const top5 = active.slice(0, 5);
    const othersVal = active.slice(5).reduce((s, f) => s + f.current_value, 0);
    const labels = top5.map(f => f.name.length > 28 ? f.name.slice(0, 26) + '…' : f.name);
    const values = top5.map(f => f.current_value);
    if (othersVal > 0) { labels.push('Others'); values.push(othersVal); }

    const ctx = document.getElementById('ch-concentration').getContext('2d');
    charts['concentration'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data: values, backgroundColor: C.palette.slice(0, values.length), borderWidth: 2, borderColor: C.chartBorder, hoverOffset: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '55%',
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
                tooltip: { callbacks: { label: c => ' ' + lakh(c.parsed) + ' (' + (c.parsed / total * 100).toFixed(1) + '%)' } },
                title: { display: true, text: 'Top fund = ' + (active[0].current_value / total * 100).toFixed(1) + '% of portfolio', color: '#94a3b8', font: { size: 11 } }
            }
        }
    });
}


/* ── AMC DIVERSIFICATION ───────────────────────────────────────────── */
function parseAMC(fundName) {
    const amcPatterns = [
        [/^absl|^aditya birla|^birla sun life/i, 'Aditya Birla SL'],
        [/^dsp/i, 'DSP'],
        [/^hdfc/i, 'HDFC'],
        [/^sbi/i, 'SBI'],
        [/^icici|^prudential/i, 'ICICI Prudential'],
        [/^axis/i, 'Axis'],
        [/^kotak/i, 'Kotak'],
        [/^nippon|^reliance/i, 'Nippon India'],
        [/^tata/i, 'Tata'],
        [/^uti/i, 'UTI'],
        [/^mirae/i, 'Mirae Asset'],
        [/^motilal|^mofsl/i, 'Motilal Oswal'],
        [/^parag parikh|^ppfas/i, 'PPFAS'],
        [/^canara/i, 'Canara Robeco'],
        [/^franklin|^templeton/i, 'Franklin Templeton'],
        [/^sundaram/i, 'Sundaram'],
        [/^invesco/i, 'Invesco'],
        [/^l&t|^bandhan/i, 'Bandhan'],
        [/^quant/i, 'Quant'],
        [/^edelweiss/i, 'Edelweiss'],
    ];
    for (const [pat, name] of amcPatterns) {
        if (pat.test(fundName)) return name;
    }
    return fundName.split(/\s+/).slice(0, 2).join(' ');
}

function renderAMCDiversification(funds) {
    killChart('amc');
    const active = funds.filter(f => f.current_value > 0);
    if (!active.length) return;

    const amcMap = {};
    active.forEach(f => {
        const amc = parseAMC(f.name);
        amcMap[amc] = (amcMap[amc] || 0) + f.current_value;
    });

    const sorted = Object.entries(amcMap).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, v]) => s + v, 0);

    const ctx = document.getElementById('ch-amc').getContext('2d');
    charts['amc'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: sorted.map(([k]) => k),
            datasets: [{ data: sorted.map(([, v]) => v), backgroundColor: C.palette.slice(0, sorted.length), borderWidth: 2, borderColor: C.chartBorder, hoverOffset: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '55%',
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
                tooltip: { callbacks: { label: c => ' ' + lakh(c.parsed) + ' (' + (c.parsed / total * 100).toFixed(1) + '%)' } },
                title: { display: true, text: sorted.length + ' AMCs in portfolio', color: '#94a3b8', font: { size: 11 } }
            }
        }
    });
}


/* ── INVESTMENT CONSISTENCY HEATMAP ─────────────────────────────────── */
function renderConsistency(yearData) {
    const grid = document.getElementById('consistency-grid');
    grid.innerHTML = '';

    const monthMap = {};
    yearData.forEach(yr => {
        (yr.txns || []).forEach(t => {
            const tp = (t.type || '').toUpperCase();
            if (tp === 'PURCHASE' || tp === 'PURCHASE_SIP') {
                const m = t.date.slice(0, 7);
                monthMap[m] = (monthMap[m] || 0) + 1;
            }
        });
    });

    const allMonths = Object.keys(monthMap).sort();
    if (!allMonths.length) {
        grid.innerHTML = '<div style="padding:1rem;color:var(--text-muted)">No purchase transactions found.</div>';
        return;
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const start = new Date(allMonths[0] + '-01');
    const end = new Date(allMonths[allMonths.length - 1] + '-01');
    const months = [];
    const cur = new Date(start);
    while (cur <= end) {
        const key = cur.toISOString().slice(0, 7);
        months.push(key);
        cur.setMonth(cur.getMonth() + 1);
    }

    const shown = months.slice(-36);

    shown.forEach(m => {
        const count = monthMap[m] || 0;
        const lvl = count === 0 ? 0 : count <= 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
        const [y, mo] = m.split('-');
        const label = monthNames[parseInt(mo) - 1] + ' ' + y.slice(2);

        const div = document.createElement('div');
        div.className = 'consistency-month';
        div.innerHTML = `
            <div class="consistency-cell lvl-${lvl}" title="${label}: ${count} purchase(s)">${count || ''}</div>
            <div class="label">${monthNames[parseInt(mo) - 1]}<br>${y.slice(2)}</div>
        `;
        grid.appendChild(div);
    });
}


/* ── DORMANT FUNDS ──────────────────────────────────────────────────── */
function renderDormant(funds) {
    const tbody = document.getElementById('dormant-funds');
    tbody.innerHTML = '';
    const dormant = funds.filter(f => f.current_value <= 0 && f.invested > 0);

    if (!dormant.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem">✅ No dormant funds — all holdings are active</td></tr>';
        return;
    }
    dormant.forEach(f => {
        const totalOut = (f.redeemed || 0) + (f.switched_out || 0);
        let status, statusClass, realizedPnL;

        if ((f.switched_out || 0) > 0 && (f.redeemed || 0) === 0) {
            status = 'Switched';
            statusClass = 'txn-other';
            realizedPnL = null;
        } else if ((f.redeemed || 0) > 0) {
            status = 'Redeemed';
            statusClass = 'txn-sell';
            realizedPnL = totalOut - f.invested;
        } else {
            status = 'Exited';
            statusClass = 'txn-other';
            realizedPnL = 0;
        }

        const pnlHtml = realizedPnL != null
            ? `<span class="${realizedPnL >= 0 ? 'positive' : 'negative'}">${lakh(realizedPnL)}</span>`
            : '<span style="color:var(--text-muted)">Internal Transfer</span>';

        tbody.innerHTML += `<tr>
            <td class="fund-name">${f.name}</td>
            <td class="num">${lakh(f.invested)}</td>
            <td class="num">${lakh(totalOut)}</td>
            <td><span class="txn-type ${statusClass}">${status}</span></td>
            <td class="num">${pnlHtml}</td>
        </tr>`;
    });
}


/* ── PORTFOLIO HEALTH CHECK ────────────────────────────────────────── */
function renderHealthCheck(funds, yearData, summary) {
    const container = document.getElementById('health-cards');
    container.innerHTML = '';
    const cards = [];
    const active = funds.filter(f => f.current_value > 0);

    const numActive = active.length;
    const divStatus = numActive >= 6 ? 'good' : numActive >= 3 ? 'warn' : 'bad';
    const divLabel = numActive >= 6 ? 'Well Diversified' : numActive >= 3 ? 'Could Improve' : 'Too Concentrated';
    cards.push({ title: 'Fund Diversification', value: numActive + ' active funds', badge: divLabel, badgeCls: divStatus, desc: numActive >= 6 ? 'Good spread across funds' : 'Consider adding more funds for risk distribution' });

    if (active.length) {
        const totalVal = active.reduce((s, f) => s + f.current_value, 0);
        const topPct = (active[0].current_value / totalVal * 100);
        const concStatus = topPct < 25 ? 'good' : topPct < 40 ? 'warn' : 'bad';
        const concLabel = topPct < 25 ? 'Low Risk' : topPct < 40 ? 'Moderate' : 'High Risk';
        cards.push({ title: 'Top Fund Concentration', value: topPct.toFixed(1) + '%', badge: concLabel, badgeCls: concStatus, desc: 'Largest fund: ' + (active[0].name.length > 40 ? active[0].name.slice(0, 38) + '…' : active[0].name) });
    }

    if (summary.overall_xirr != null) {
        const x = summary.overall_xirr;
        const xStatus = x >= 12 ? 'good' : x >= 6 ? 'warn' : 'bad';
        const xLabel = x >= 12 ? 'Excellent' : x >= 6 ? 'Average' : 'Below Average';
        cards.push({ title: 'Portfolio XIRR', value: pct(x), badge: xLabel, badgeCls: xStatus, desc: x >= 12 ? 'Beating most FD and debt instruments' : x >= 6 ? 'On par with conservative investing' : 'Consider reviewing fund selection' });
    }

    if (yearData.length) {
        const yrs = yearData.length;
        const yrStatus = yrs >= 7 ? 'good' : yrs >= 3 ? 'warn' : 'bad';
        const yrLabel = yrs >= 7 ? 'Long Term' : yrs >= 3 ? 'Medium Term' : 'Short Term';
        cards.push({ title: 'Investment Tenure', value: yrs + ' Financial Years', badge: yrLabel, badgeCls: yrStatus, desc: yrs >= 7 ? 'Long-term wealth creation in progress' : 'Stay invested — long-term compounding is key' });
    }

    if (summary.total_invested > 0) {
        const gainPct = summary.abs_return_pct;
        const gStatus = gainPct >= 30 ? 'good' : gainPct >= 10 ? 'warn' : 'bad';
        const gLabel = gainPct >= 30 ? 'Strong' : gainPct >= 10 ? 'Moderate' : 'Weak';
        cards.push({ title: 'Unrealized Returns', value: pct(gainPct), badge: gLabel, badgeCls: gStatus, desc: 'Overall portfolio absolute return on invested capital' });
    }

    const dormantCount = funds.filter(f => f.current_value <= 0 && f.invested > 0).length;
    if (dormantCount > 0) {
        cards.push({ title: 'Dormant Funds', value: dormantCount + ' fund' + (dormantCount > 1 ? 's' : ''), badge: 'Attention', badgeCls: 'warn', desc: 'Fully redeemed funds — check if exit was planned' });
    }

    const amcs = new Set(active.map(f => parseAMC(f.name)));
    const amcStatus = amcs.size >= 4 ? 'good' : amcs.size >= 2 ? 'warn' : 'bad';
    cards.push({ title: 'AMC Spread', value: amcs.size + ' AMC' + (amcs.size !== 1 ? 's' : ''), badge: amcs.size >= 4 ? 'Diversified' : 'Limited', badgeCls: amcStatus, desc: amcs.size >= 4 ? 'Good distribution across fund houses' : 'Consider spreading across more AMCs for safety' });

    cards.forEach(c => {
        container.innerHTML += `<div class="h-card">
            <div class="h-title">${c.title}</div>
            <div class="h-value">${c.value} <span class="h-badge ${c.badgeCls}">${c.badge}</span></div>
            <div class="h-desc">${c.desc}</div>
        </div>`;
    });
}


/* ── FUND CATEGORY CLASSIFICATION ──────────────────────────────────── */
function parseCategory(fundName) {
    const s = fundName.toLowerCase();
    if (/liquid|overnight|money market|ultra short/i.test(s)) return 'Liquid / UST';
    if (/elss|tax sav/i.test(s)) return 'ELSS';
    if (/gilt|gsec|government|sovereign/i.test(s)) return 'Gilt';
    if (/debt|bond|income|credit risk|banking \&amp; psu|corporate bond|fixed maturity|fmp|short duration|medium duration|long duration|dynamic bond|low duration/i.test(s)) return 'Debt';
    if (/hybrid|balanced|equity savings|aggressive|conservative|multi.?asset|arbitrage/i.test(s)) return 'Hybrid';
    if (/index|nifty|sensex|etf|s\s*&\s*p|bse/i.test(s)) return 'Index / ETF';
    if (/small\s*cap/i.test(s)) return 'Small Cap';
    if (/mid\s*cap/i.test(s)) return 'Mid Cap';
    if (/large\s*cap|large\s*&|bluechip|blue\s*chip/i.test(s)) return 'Large Cap';
    if (/flexi|multi|focused|contra|value|dividend yield|thematic|sectoral|infra|pharma|banking|technology|consumption|energy|commodit|international|global|us equity|nasdaq/i.test(s)) return 'Equity - Thematic';
    if (/equity|growth/i.test(s)) return 'Equity';
    return 'Other';
}

function renderFundCategories(funds, summary) {
    killChart('categories');
    const active = funds.filter(f => f.current_value > 0);
    const container = document.getElementById('category-summary');
    if (!active.length) {
        if (container) container.innerHTML = '<div style="padding:1rem;color:var(--text-muted)">No active funds to classify.</div>';
        return;
    }

    const catMap = {};
    active.forEach(f => {
        const cat = parseCategory(f.name);
        if (!catMap[cat]) catMap[cat] = { value: 0, count: 0 };
        catMap[cat].value += f.current_value;
        catMap[cat].count++;
    });

    const sorted = Object.entries(catMap).sort((a, b) => b[1].value - a[1].value);
    const total = summary.current_value || sorted.reduce((s, [, v]) => s + v.value, 0);

    if (container) {
        container.innerHTML = sorted.map(([cat, d]) =>
            `<div class="cat-chip"><span class="cat-name">${cat}</span><span class="cat-val">${lakh(d.value)}</span><span class="cat-pct">${(d.value / total * 100).toFixed(1)}%</span><span class="cat-count">${d.count} fund${d.count > 1 ? 's' : ''}</span></div>`
        ).join('');
    }

    const canvas = document.getElementById('ch-categories');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    charts['categories'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: sorted.map(([k]) => k),
            datasets: [{ data: sorted.map(([, v]) => v.value), backgroundColor: C.palette.slice(0, sorted.length), borderWidth: 2, borderColor: '#0e1120', hoverOffset: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '55%',
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
                tooltip: { callbacks: { label: c => ' ' + lakh(c.parsed) + ' (' + (c.parsed / total * 100).toFixed(1) + '%)' } },
                title: { display: true, text: sorted.length + ' categories detected', color: '#94a3b8', font: { size: 11 } }
            }
        }
    });
}


/* ── SIP vs LUMPSUM CHART ──────────────────────────────────────────── */
function renderSIPvsLumpsum(yearData, summary) {
    killChart('siplump');
    const hasSipData = yearData.some(r => (r.sip || 0) > 0 || (r.lumpsum || 0) > 0);
    if (!hasSipData) {
        const ctx = document.getElementById('ch-siplump');
        if (ctx) ctx.parentElement.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted)">No SIP/Lumpsum data available</div>';
        return;
    }

    const canvas = document.getElementById('ch-siplump');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    charts['siplump'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: yearData.map(r => r.fy),
            datasets: [
                {
                    label: 'SIP',
                    data: yearData.map(r => r.sip || 0),
                    backgroundColor: 'rgba(16,185,129,0.75)',
                    borderRadius: 6,
                    borderSkipped: false,
                },
                {
                    label: 'Lumpsum',
                    data: yearData.map(r => r.lumpsum || 0),
                    backgroundColor: 'rgba(99,102,241,0.75)',
                    borderRadius: 6,
                    borderSkipped: false,
                },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + lakh(c.parsed.y) } }
            },
            scales: {
                x: { stacked: true, grid: { color: C.gridColor } },
                y: { stacked: true, grid: { color: C.gridColor }, ticks: { callback: v => lakh(v) } }
            }
        }
    });
}
