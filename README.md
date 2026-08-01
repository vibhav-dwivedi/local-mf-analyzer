# 📊 Local MF Analyzer

A **privacy-first Mutual Fund Portfolio Analyzer** that parses your KFintech / myCAMS Consolidated Account Statement (CAS) PDF and gives you a rich, interactive dashboard — all processed **locally on your device**. Nothing leaves your machine.

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
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
- 🔒 **100% Local Processing** — Your PDF is read in-memory, never written to disk
- 🚫 **No External API Calls** — All parsing and analysis happens on your machine
- 🗑️ **No Data Persistence** — Nothing is stored after you close the browser

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python, FastAPI, Uvicorn |
| **PDF Parsing** | [casparser](https://github.com/codelif/casparser) |
| **XIRR Calculation** | [pyxirr](https://github.com/Anexen/pyxirr) |
| **Frontend** | Vanilla HTML, CSS, JavaScript |
| **Charts** | Chart.js |

---

## 🚀 Getting Started

### Prerequisites
- Python 3.9 or higher
- pip

### Installation

```bash
# Clone the repo
git clone https://github.com/vibhav-dwivedi/local-mf-analyzer.git
cd local-mf-analyzer

# Create a virtual environment
python3 -m venv venv
source venv/bin/activate        # Linux/macOS
# venv\Scripts\activate          # Windows

# Install dependencies
pip install -r requirements.txt
```

### Running the App

```bash
# Start the server
uvicorn backend.main:app --reload --port 8000
```

Open your browser and go to **http://localhost:8000**

### Usage
1. Upload your **KFintech or myCAMS CAS PDF** statement
2. Enter the PDF password (usually your PAN in lowercase, e.g., `aabcp1234a`)
3. Explore your portfolio dashboard!

---

## 📁 Project Structure

```
local-mf-analyzer/
├── backend/
│   └── main.py              # FastAPI server & CAS parsing logic
├── frontend/
│   ├── index.html            # Main HTML (upload + dashboard screens)
│   ├── app.js                # Dashboard rendering & chart logic
│   └── style.css             # Dark/light theme styles
├── diagnostic.py             # CLI tool for debugging CAS PDF parsing
├── requirements.txt          # Python dependencies
├── .gitignore
└── README.md
```

---

## 🔧 Diagnostic Tool

For debugging CAS PDF parsing issues:

```bash
python3 diagnostic.py <path_to_pdf> <password>
```

This prints the raw structure returned by casparser, useful for troubleshooting.

---

## 🎨 Themes

The app supports both **Dark** and **Light** themes. Toggle using the 🌙/☀️ button in the top-right corner. Your preference is saved in `localStorage`.

---

## 📝 Notes

- This tool works with CAS PDFs from **KFintech** and **myCAMS**
- You can download your CAS from [KFintech](https://mfs.kfintech.com/) or [myCAMS](https://mycams.camsonline.com/)
- The XIRR calculation uses actual transaction dates for accurate annualized returns
- Fund categories and AMC names are auto-detected from fund names using pattern matching

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
