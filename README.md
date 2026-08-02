# 📊 Local MF Analyzer

A **privacy-first Mutual Fund Portfolio Analyzer** that parses your KFintech / myCAMS Consolidated Account Statement (CAS) PDF and gives you a rich, interactive dashboard — all processed **locally on your machine**. Nothing leaves your device.

[![Run Locally](https://img.shields.io/badge/🖥️_Run_Locally-FastAPI-009688?style=for-the-badge)](#option-2-run-locally-recommended)
[![GitHub Pages](https://img.shields.io/badge/⚠️_GitHub_Pages-Work_In_Progress-f59e0b?style=for-the-badge)](https://vibhav-dwivedi.github.io/local-mf-analyzer/frontend/)

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

> **⚠️ GitHub Pages (Browser-Only Mode) — WORK IN PROGRESS**
>
> The GitHub Pages hosted version (`https://vibhav-dwivedi.github.io/...`) is **not yet fully functional**.
> We are building a hybrid browser-only architecture (pdf.js + Pyodide Python stdlib parser) to eliminate
> `casparser`/micropip installation failures in the WASM environment. This is pending completion.
>
> **For a fully working experience, run locally using Option 2 below.**

---

## ✨ Features

### Overview Dashboard
- **Portfolio KPIs** — Total Invested, Current Value, Gains, XIRR, Dividends, SIP vs Lumpsum split
- **Year-wise Summary** — Financial year breakdown with click-to-drill-down transactions
- **Cumulative Investment Chart** — Track your net invested amount over time
- **Portfolio Allocation** — Doughnut chart showing fund-wise current value distribution
- **Fund-wise XIRR** — Horizontal bar chart comparing returns across funds
- **Fund Breakdown Table** — Detailed per-fund invested, current value, gain/loss, XIRR with year-on-year drill-down

### Insights Dashboard
- 🏆 **Top & Bottom Performers** — Ranked by XIRR
- 📊 **Concentration Risk** — See if your portfolio is too heavy on one fund
- 🏢 **AMC Diversification** — Distribution across fund houses
- 💰 **SIP vs Lumpsum** — Year-wise stacked bar chart
- 🏷️ **Fund Category Allocation** — Auto-classifies funds into Equity, Debt, Hybrid, ELSS, etc.
- 📅 **Investment Consistency Heatmap** — Monthly purchase activity visualization
- 💤 **Dormant Funds** — Identifies fully redeemed / zero-balance funds with realized P&L
- 🩺 **Portfolio Health Check** — Automated checks for diversification, concentration, tenure, and returns

### Privacy & Security
- 🔒 **All Processing On Your Machine** — Your PDF is read locally, never uploaded anywhere
- 🚫 **No External API Calls** — All parsing and analysis happens on your machine
- 💾 **Optional Local Storage** — Save analysis snapshots in your browser (IndexedDB) for tracking changes over time

---

## 🚀 How to Use

### Option 2: Run Locally (Recommended — Fully Working)

```bash
# Clone the repo
git clone https://github.com/vibhav-dwivedi/local-mf-analyzer.git
cd local-mf-analyzer

# Create & activate a virtual environment
cd backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r ../requirements.txt

# Start the server
uvicorn main:app --reload --port 8000
```

Open **[http://localhost:8000](http://localhost:8000)** in your browser.

1. Upload your **KFintech or myCAMS CAS PDF** statement
2. Enter the PDF password (usually your PAN in lowercase, e.g., `aabcp1234a`)
3. Explore your portfolio dashboard!

### Option 1: Use Online (Work In Progress)

> ⚠️ GitHub Pages browser-only mode is currently under development. See note above.

👉 **[https://vibhav-dwivedi.github.io/local-mf-analyzer/frontend/](https://vibhav-dwivedi.github.io/local-mf-analyzer/frontend/)**

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **PDF Parsing** | [casparser](https://github.com/codelif/casparser) (local) / pdf.js + Python stdlib (browser — WIP) |
| **XIRR Calculation** | [pyxirr](https://github.com/Anexen/pyxirr) + pure-Python fallback |
| **Frontend** | Vanilla HTML, CSS, JavaScript |
| **Charts** | Chart.js |
| **Persistence** | IndexedDB (browser storage) |
| **Local Backend** | Python 3.9+, FastAPI, Uvicorn |
| **Hosting** | GitHub Pages (browser-only mode — WIP) |

---

## 📁 Project Structure

```
local-mf-analyzer/
├── analyzer.py                  # Root analyzer (used by FastAPI backend)
├── backend/
│   └── main.py                  # FastAPI server (for local dev)
├── frontend/
│   ├── index.html               # Main HTML (upload → dashboard)
│   ├── app.js                   # Dashboard rendering + dual-mode routing
│   ├── pyodide-worker.js        # Web Worker: Pyodide Python runtime (browser mode — WIP)
│   ├── analyzer.py              # Pure-stdlib Python CAS parser for browser mode (WIP)
│   ├── storage.js               # IndexedDB wrapper for analysis snapshots
│   └── style.css                # Dark/light theme styles
├── diagnostic.py                # CLI tool for debugging CAS PDF parsing
├── requirements.txt             # Python dependencies
├── .github/workflows/
│   └── deploy.yml               # GitHub Actions → Pages deployment
├── LICENSE
└── README.md
```

---

## ⚠️ Known Issues / Pending Work

### GitHub Pages Browser-Only Mode (PENDING)
The app is designed to eventually work **without any server** via GitHub Pages. The architecture planned is:

1. **pdf.js** (JavaScript) — decrypts and extracts text from the CAS PDF in the browser
2. **Pyodide** (Python in WebAssembly, stdlib only) — parses CAS text using regex and computes XIRR
3. **No package installs** — `casparser`/`micropip` wheel installs fail in the Pyodide WASM environment

Current status:
- [x] pdf.js text extraction works
- [x] Pyodide loads (stdlib only, no packages)
- [x] Pure-stdlib Python CAS parser written (`frontend/analyzer.py`)
- [ ] End-to-end parsing accuracy needs validation against real CAS statements in the browser
- [ ] GitHub Pages deployment of browser-only mode not yet validated

---

## 📝 Notes

- Works with CAS PDFs from **KFintech** and **myCAMS**
- Download your CAS from [KFintech](https://mfs.kfintech.com/) or [myCAMS](https://mycams.camsonline.com/)
- XIRR uses actual transaction dates for accurate annualized returns
- Fund categories and AMC names are auto-detected via pattern matching
- Analysis snapshots are saved in your browser's IndexedDB — revisit to track changes

---

## 📄 License

This project is open source under the [MIT License](LICENSE).
