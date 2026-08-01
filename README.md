# 📊 Local MF Analyzer

A **privacy-first Mutual Fund Portfolio Analyzer** that parses your KFintech / myCAMS Consolidated Account Statement (CAS) PDF and gives you a rich, interactive dashboard — all processed **locally in your browser**. Nothing leaves your device.

[![Try it Online](https://img.shields.io/badge/🚀_Try_it_Online-GitHub_Pages-6366f1?style=for-the-badge)](https://vibhav-dwivedi.github.io/local-mf-analyzer/frontend/)

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![Pyodide](https://img.shields.io/badge/Pyodide-In_Browser-f59e0b?logo=python&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow)

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
- 🔒 **100% In-Browser Processing** — Python runs via WebAssembly (Pyodide), no server needed
- 🚫 **No External API Calls** — All parsing and analysis happens on your machine
- 🗑️ **No Data Sent Anywhere** — Your PDF never leaves your browser
- 💾 **Optional Local Storage** — Save analysis snapshots in your browser (IndexedDB) for tracking changes over time

---

## � How to Use

### Option 1: Use Online (Recommended)
Just visit the hosted version — **no installation needed**:

👉 **[https://vibhav-dwivedi.github.io/local-mf-analyzer/frontend/](https://vibhav-dwivedi.github.io/local-mf-analyzer/frontend/)**

1. Wait for the Python runtime to load in your browser (~5 seconds)
2. Upload your **KFintech or myCAMS CAS PDF** statement
3. Enter the PDF password (usually your PAN in lowercase, e.g., `aabcp1234a`)
4. Explore your portfolio dashboard!

> Your data never leaves your browser. The Python runtime (Pyodide) runs entirely in WebAssembly.

### Option 2: Run Locally (For Developers)

```bash
# Clone the repo
git clone https://github.com/vibhav-dwivedi/local-mf-analyzer.git
cd local-mf-analyzer

# Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn backend.main:app --reload --port 8000
```

Open **http://localhost:8000** — the app auto-detects the local backend and uses it directly (no Pyodide needed).

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Browser Runtime** | [Pyodide](https://pyodide.org/) (Python in WebAssembly) |
| **PDF Parsing** | [casparser](https://github.com/codelif/casparser) |
| **XIRR Calculation** | [pyxirr](https://github.com/Anexen/pyxirr) + pure-Python fallback |
| **Frontend** | Vanilla HTML, CSS, JavaScript |
| **Charts** | Chart.js |
| **Persistence** | IndexedDB (browser storage) |
| **Local Backend** | Python, FastAPI, Uvicorn (optional, for dev) |
| **Hosting** | GitHub Pages (static files) |

---

## 📁 Project Structure

```
local-mf-analyzer/
├── analyzer.py                # Core analysis engine (shared by Pyodide & backend)
├── backend/
│   └── main.py                # FastAPI server (optional, for local dev)
├── frontend/
│   ├── index.html             # Main HTML (loading → upload → dashboard)
│   ├── app.js                 # Dashboard rendering, dual-mode (Pyodide / backend)
│   ├── pyodide-worker.js      # Web Worker for in-browser Python execution
│   ├── storage.js             # IndexedDB wrapper for analysis snapshots
│   └── style.css              # Dark/light theme styles
├── diagnostic.py              # CLI tool for debugging CAS PDF parsing
├── requirements.txt           # Python dependencies (for local dev)
├── .github/workflows/
│   └── deploy.yml             # GitHub Actions → Pages deployment
├── LICENSE                    # MIT License
└── README.md
```

---

## 🎨 Themes

The app supports both **Dark** and **Light** themes. Toggle using the 🌙/☀️ button. Your preference is saved in `localStorage`.

---

## 📝 Notes

- Works with CAS PDFs from **KFintech** and **myCAMS**
- Download your CAS from [KFintech](https://mfs.kfintech.com/) or [myCAMS](https://mycams.camsonline.com/)
- XIRR uses actual transaction dates for accurate annualized returns
- Fund categories and AMC names are auto-detected via pattern matching
- Analysis snapshots are saved in your browser's IndexedDB — revisit to track changes

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

---

## 📄 License

This project is open source under the [MIT License](LICENSE).
