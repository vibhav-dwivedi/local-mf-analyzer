import io
import os
import datetime
import traceback
from collections import defaultdict
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import casparser

app = FastAPI(title="Mutual Fund Analyzer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def safe_float(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except Exception:
        return 0.0


def to_date(dt_raw) -> datetime.date | None:
    """Normalise whatever casparser gives us to a datetime.date."""
    if isinstance(dt_raw, datetime.datetime):
        return dt_raw.date()
    if isinstance(dt_raw, datetime.date):
        return dt_raw
    try:
        return datetime.datetime.strptime(str(dt_raw), "%Y-%m-%d").date()
    except Exception:
        return None


def financial_year(d: datetime.date) -> str:
    """Return Indian financial year label for a date, e.g. 'FY 2023-24'."""
    if d.month >= 4:          # April-March
        return f"FY {d.year}-{str(d.year + 1)[2:]}"
    else:
        return f"FY {d.year - 1}-{str(d.year)[2:]}"


def fy_sort_key(fy_label: str) -> int:
    """'FY 2023-24' -> 2023  for sorting."""
    try:
        return int(fy_label.split()[1].split("-")[0])
    except Exception:
        return 0


# ── Upload endpoint ─────────────────────────────────────────────────────────────

@app.post("/api/debug")
async def debug_cas(
    file: UploadFile = File(...),
    password: str = Form(...)
):
    """Debug endpoint – returns first 3 transactions raw so we can verify field names."""
    import json
    content = await file.read()
    data = casparser.read_cas_pdf(io.BytesIO(content), password)
    if hasattr(data, 'model_dump'):
        parsed = data.model_dump()
    elif hasattr(data, 'dict'):
        parsed = data.dict()
    else:
        parsed = data
    samples = []
    for folio in (parsed.get("folios", []) or [])[:2]:
        for scheme in (folio.get("schemes", []) or [])[:1]:
            txns = scheme.get("transactions", []) or []
            val_obj = scheme.get("valuation", {}) or {}
            samples.append({
                "scheme_name": scheme.get("scheme"),
                "valuation": val_obj,
                "sample_txns": [dict(t) for t in txns[:5]]
            })
    return {"samples": samples}


@app.post("/api/upload")
async def upload_cas(
    file: UploadFile = File(...),
    password: str = Form(...)
):
    try:
        # ── Validate file type ─────────────────────────────────────────────
        if file.content_type and file.content_type != "application/pdf":
            raise HTTPException(status_code=400, detail="Only PDF files are accepted.")
        if file.filename and not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only .pdf files are accepted.")

        content = await file.read()
        if len(content) < 100:
            raise HTTPException(status_code=400, detail="File is too small to be a valid CAS PDF.")

        parsed_raw = casparser.read_cas_pdf(io.BytesIO(content), password)

        # mode='json' forces Pydantic to serialize:
        #   Decimal → float, datetime.date → ISO string, Enum → string value
        if hasattr(parsed_raw, "model_dump"):
            parsed = parsed_raw.model_dump(mode='json')
        elif hasattr(parsed_raw, "dict"):
            parsed = parsed_raw.dict()
        else:
            parsed = parsed_raw

        if not isinstance(parsed, dict) or "folios" not in parsed:
            raise ValueError("Unexpected CAS structure – no folios found.")

        # ── Aggregation buckets ────────────────────────────────────────────────

        total_invested  = 0.0
        total_withdrawn = 0.0
        total_dividends = 0.0
        total_switch_in = 0.0
        total_switch_out= 0.0
        current_value   = 0.0
        total_sip       = 0.0
        total_lumpsum   = 0.0
        all_flows: list[tuple[datetime.date, float]] = []   # (date, cashflow) for overall XIRR

        # FY -> { invested, withdrawn, dividends, switch_in, switch_out, sip, lumpsum, txns }
        fy_data: dict[str, dict] = defaultdict(lambda: {
            "invested": 0.0,
            "withdrawn": 0.0,
            "dividends": 0.0,
            "switch_in": 0.0,
            "switch_out": 0.0,
            "sip": 0.0,
            "lumpsum": 0.0,
            "txns": []
        })

        # fund name -> { fresh_invested, switch_in_amt, current_value, flows, ... }
        funds: dict[str, dict] = {}

        # Transaction type classification sets
        PURCHASE_TYPES = {"PURCHASE", "PURCHASE_SIP"}
        REDEEM_TYPES   = {"REDEMPTION"}
        SWITCH_IN_TYPES  = {"SWITCH_IN", "SWITCH_IN_MERGER"}
        SWITCH_OUT_TYPES = {"SWITCH_OUT", "SWITCH_OUT_MERGER"}
        DIVIDEND_TYPES   = {"DIVIDEND_PAYOUT", "DIVIDEND_REINVEST"}
        TAX_TYPES        = {"STT_TAX", "STAMP_DUTY_TAX", "TDS_TAX"}
        SKIP_TYPES       = {"SEGREGATION", "MISC", "UNKNOWN", "REVERSAL"}

        # ── Walk every folio → scheme → transaction ────────────────────────────

        for folio in parsed.get("folios", []):
            for scheme in folio.get("schemes", []):
                s_name: str = scheme.get("scheme", "Unknown Fund") if isinstance(scheme, dict) else getattr(scheme, "scheme", "Unknown Fund")

                # current valuation
                val_obj = scheme.get("valuation", {}) if isinstance(scheme, dict) else getattr(scheme, "valuation", {})
                sv = safe_float(val_obj.get("value", 0.0) if isinstance(val_obj, dict) else getattr(val_obj, "value", 0.0))
                current_value += sv

                if s_name not in funds:
                    funds[s_name] = {
                        "fresh_invested": 0.0,
                        "switch_in_amt": 0.0,
                        "current_value": 0.0,
                        "redeemed": 0.0,
                        "switched_out": 0.0,
                        "flows": [],
                        "sip": 0.0,
                        "lumpsum": 0.0,
                        "fy_data": defaultdict(lambda: {
                            "invested": 0.0,
                            "withdrawn": 0.0,
                            "dividends": 0.0,
                            "sip": 0.0,
                            "lumpsum": 0.0,
                            "net": 0.0
                        })
                    }
                funds[s_name]["current_value"] += sv

                txns = scheme.get("transactions", []) if isinstance(scheme, dict) else getattr(scheme, "transactions", [])

                for txn in txns:
                    amt_raw  = txn.get("amount")  if isinstance(txn, dict) else getattr(txn, "amount",  None)
                    dt_raw   = txn.get("date")    if isinstance(txn, dict) else getattr(txn, "date",    None)
                    units_raw= txn.get("units")   if isinstance(txn, dict) else getattr(txn, "units",   None)
                    txn_type_raw = txn.get("type", "") if isinstance(txn, dict) else getattr(txn, "type", "")
                    if hasattr(txn_type_raw, 'value'):
                        txn_type = txn_type_raw.value
                    else:
                        txn_type = str(txn_type_raw) if txn_type_raw else ""
                    nav_raw  = txn.get("nav")     if isinstance(txn, dict) else getattr(txn, "nav",     None)

                    if amt_raw is None or dt_raw is None:
                        continue

                    amt  = safe_float(amt_raw)
                    dt   = to_date(dt_raw)
                    if dt is None:
                        continue

                    units = safe_float(units_raw)
                    nav   = safe_float(nav_raw)
                    fy    = financial_year(dt)

                    # ── Classify transaction type ──────────────────────────────
                    if txn_type in PURCHASE_TYPES:
                        # Fresh money IN from investor → counts as investment
                        total_invested                   += amt
                        funds[s_name]["fresh_invested"]   += amt
                        fy_data[fy]["invested"]           += amt
                        funds[s_name]["fy_data"][fy]["invested"] += amt
                        funds[s_name]["fy_data"][fy]["net"]      += amt
                        # Track SIP vs Lumpsum
                        if txn_type == "PURCHASE_SIP":
                            total_sip                    += amt
                            fy_data[fy]["sip"]           += amt
                            funds[s_name]["sip"]         += amt
                            funds[s_name]["fy_data"][fy]["sip"] += amt
                        else:
                            total_lumpsum                += amt
                            fy_data[fy]["lumpsum"]       += amt
                            funds[s_name]["lumpsum"]     += amt
                            funds[s_name]["fy_data"][fy]["lumpsum"] += amt
                        # XIRR: cash out from investor
                        all_flows.append((dt, -amt))
                        funds[s_name]["flows"].append((dt, -amt))

                    elif txn_type in REDEEM_TYPES:
                        # Real money OUT to investor → counts as withdrawal
                        total_withdrawn            += abs(amt)
                        fy_data[fy]["withdrawn"]   += abs(amt)
                        funds[s_name]["redeemed"]  += abs(amt)
                        funds[s_name]["fy_data"][fy]["withdrawn"] += abs(amt)
                        funds[s_name]["fy_data"][fy]["net"]       -= abs(amt)
                        all_flows.append((dt, -amt))  # amt is negative, so -amt is positive (cash in)
                        funds[s_name]["flows"].append((dt, -amt))

                    elif txn_type in SWITCH_IN_TYPES:
                        # Money arriving from another fund → internal transfer
                        # Still counts for this fund's XIRR, but NOT as fresh investment
                        total_switch_in                  += amt
                        fy_data[fy]["switch_in"]         += amt
                        funds[s_name]["switch_in_amt"]   += amt  # separate from fresh
                        funds[s_name]["fy_data"][fy]["invested"] += amt # treat as invested for fund YOY
                        funds[s_name]["fy_data"][fy]["net"]      += amt
                        all_flows.append((dt, -amt))
                        funds[s_name]["flows"].append((dt, -amt))

                    elif txn_type in SWITCH_OUT_TYPES:
                        # Money leaving to another fund → internal transfer
                        total_switch_out              += abs(amt)
                        fy_data[fy]["switch_out"]     += abs(amt)
                        funds[s_name]["switched_out"] += abs(amt)
                        funds[s_name]["fy_data"][fy]["withdrawn"] += abs(amt)
                        funds[s_name]["fy_data"][fy]["net"]       -= abs(amt)
                        all_flows.append((dt, -amt))
                        funds[s_name]["flows"].append((dt, -amt))

                    elif txn_type in DIVIDEND_TYPES:
                        # Dividend = profit earned, not investment
                        total_dividends              += abs(amt)
                        fy_data[fy]["dividends"]     += abs(amt)
                        funds[s_name]["fy_data"][fy]["dividends"] += abs(amt)
                        # For XIRR: dividend reinvest is cash neutral (stays in fund)
                        # dividend payout is cash received
                        if txn_type == "DIVIDEND_PAYOUT" and amt < 0:
                            all_flows.append((dt, abs(amt)))  # cash in
                            funds[s_name]["flows"].append((dt, abs(amt)))
                        # Dividend reinvest: units added but no cash movement for investor

                    elif txn_type in TAX_TYPES:
                        # Taxes are deducted; small amounts, track but don't count as investment
                        pass  # still show in drill-down

                    else:
                        # MISC / UNKNOWN / REVERSAL — include in XIRR if non-zero
                        if amt != 0:
                            all_flows.append((dt, -amt))
                            funds[s_name]["flows"].append((dt, -amt))

                    # Store transaction summary for drill-down (NO PAN/address)
                    fy_data[fy]["txns"].append({
                        "scheme":  s_name,
                        "date":    dt.isoformat(),
                        "type":    txn_type,
                        "amount":  round(amt, 2),
                        "units":   round(units, 4) if units else None,
                        "nav":     round(nav, 4)   if nav   else None,
                    })

        # ── XIRR calculation ────────────────────────────────────────────────────

        from pyxirr import xirr as pyxirr_xirr

        today = datetime.date.today()

        def calc_xirr(flows, terminal_value=0.0) -> float | None:
            if not flows:
                return None
            try:
                result = pyxirr_xirr(flows + [(today, terminal_value)])
                if result is None or result != result:   # NaN guard
                    return None
                return float(result) * 100               # return as %
            except Exception:
                return None

        overall_xirr = calc_xirr(all_flows, current_value)

        # Per-fund XIRR
        fund_list = []
        for fname, fd in funds.items():
            # Total cost basis = fresh purchases + switch-ins
            total_cost = fd["fresh_invested"] + fd["switch_in_amt"]
            if total_cost <= 0:
                continue
            cv      = fd["current_value"]
            
            # Gain = Current Value + Net Cash Flow (Sum of flows)
            # flows are negative for cash out (purchases), positive for cash in (redemptions/dividends)
            gain    = cv + sum(amt for _, amt in fd["flows"])
            fxirr   = calc_xirr(fd["flows"], cv)
            basis   = total_cost
            abs_ret = (gain / basis * 100) if basis > 0 else 0.0
            
            # Convert fy_data to sorted list
            fund_fy_list = []
            for fy_k in sorted(fd["fy_data"].keys(), key=fy_sort_key):
                f_fy = fd["fy_data"][fy_k]
                fund_fy_list.append({
                    "fy": fy_k,
                    "invested": round(f_fy["invested"], 2),
                    "withdrawn": round(f_fy["withdrawn"], 2),
                    "dividends": round(f_fy["dividends"], 2),
                    "sip": round(f_fy["sip"], 2),
                    "lumpsum": round(f_fy["lumpsum"], 2),
                    "net": round(f_fy["net"], 2)
                })

            fund_list.append({
                "name":          fname,
                "invested":      round(total_cost,          2),
                "fresh_invested":round(fd["fresh_invested"],2),
                "switch_in_amt": round(fd["switch_in_amt"], 2),
                "current_value": round(cv,                  2),
                "gain":          round(gain,                2),
                "abs_return":    round(abs_ret,             2),
                "xirr":          round(fxirr, 2) if fxirr is not None else None,
                "redeemed":      round(fd["redeemed"],      2),
                "switched_out":  round(fd["switched_out"],  2),
                "sip":           round(fd["sip"],           2),
                "lumpsum":       round(fd["lumpsum"],       2),
                "fy_data":       fund_fy_list,
            })
        fund_list.sort(key=lambda x: x["current_value"], reverse=True)

        # ── Year-wise summary ───────────────────────────────────────────────────

        # Running cumulative to compute rough year-end invested balance
        sorted_fys = sorted(fy_data.keys(), key=fy_sort_key)
        cumulative_invested = 0.0
        cumulative_withdrawn = 0.0
        year_list = []

        for fy in sorted_fys:
            fd   = fy_data[fy]
            inv  = fd["invested"]
            wdw  = fd["withdrawn"]
            div  = fd["dividends"]
            sw_i = fd["switch_in"]
            sw_o = fd["switch_out"]
            cumulative_invested   += inv
            cumulative_withdrawn  += wdw
            net_year = inv - wdw

            fd["txns"].sort(key=lambda t: t["date"])

            year_list.append({
                "fy":                  fy,
                "invested":            round(inv, 2),
                "withdrawn":           round(wdw, 2),
                "dividends":           round(div, 2),
                "switch_in":           round(sw_i, 2),
                "switch_out":          round(sw_o, 2),
                "sip":                 round(fd["sip"], 2),
                "lumpsum":             round(fd["lumpsum"], 2),
                "net":                 round(net_year, 2),
                "cumulative_invested": round(cumulative_invested, 2),
                "txn_count":           len(fd["txns"]),
                "txns":                fd["txns"],
            })

        # ── Summary totals ──────────────────────────────────────────────────────

        total_gains   = (current_value + total_withdrawn) - total_invested
        abs_return    = (total_gains / total_invested * 100) if total_invested > 0 else 0.0
        num_funds     = len([f for f in fund_list if f["current_value"] > 0])
        num_years     = len(year_list)

        # Identify Top and Worst performing funds based on XIRR (min 1 year holding approx or enough invested)
        valid_funds = [f for f in fund_list if f["xirr"] is not None and f["invested"] > 1000]
        top_funds = sorted(valid_funds, key=lambda x: x["xirr"], reverse=True)[:5]
        worst_funds = sorted(valid_funds, key=lambda x: x["xirr"])[:5]

        # NOTE: No raw PII (PAN, full name, address, account numbers) is returned.
        return {
            "status": "success",
            "data": {
                "summary": {
                    "total_invested":  round(total_invested,  2),
                    "current_value":   round(current_value,   2),
                    "total_withdrawn": round(total_withdrawn,  2),
                    "total_dividends": round(total_dividends,  2),
                    "total_gains":     round(total_gains,      2),
                    "abs_return_pct":  round(abs_return,       2),
                    "overall_xirr":    round(overall_xirr, 2) if overall_xirr is not None else None,
                    "num_funds":       num_funds,
                    "num_years":       num_years,
                    "total_sip":       round(total_sip,       2),
                    "total_lumpsum":   round(total_lumpsum,   2),
                },
                "year_data":  year_list,
                "fund_data":  fund_list[:50],  # Return more funds just in case
                "top_funds":  top_funds,
                "worst_funds": worst_funds
            }
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"Failed to parse CAS: {str(e)}")


# ── Static frontend ─────────────────────────────────────────────────────────────

frontend_dir = os.path.join(os.path.dirname(__file__), "../frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
