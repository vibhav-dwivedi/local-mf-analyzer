"""
analyzer.py — Standalone MF CAS analysis engine.

Used by:
  - Pyodide (in-browser via Web Worker)
  - FastAPI backend (local dev)

Accepts raw PDF bytes + password, returns a JSON-serializable dict
with portfolio summary, year-wise data, fund-wise breakdown, and insights.
"""

import io
import datetime
from collections import defaultdict


# ── Helpers ──────────────────────────────────────────────────────────────────

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
    """Return Indian financial year label, e.g. 'FY 2023-24'."""
    if d.month >= 4:
        return f"FY {d.year}-{str(d.year + 1)[2:]}"
    else:
        return f"FY {d.year - 1}-{str(d.year)[2:]}"


def fy_sort_key(fy_label: str) -> int:
    """'FY 2023-24' -> 2023 for sorting."""
    try:
        return int(fy_label.split()[1].split("-")[0])
    except Exception:
        return 0


# ── Pure-Python XIRR (Newton-Raphson fallback) ──────────────────────────────

def _xirr_pure(flows: list[tuple[datetime.date, float]], guess: float = 0.1) -> float | None:
    """
    Compute XIRR using Newton-Raphson method.
    flows: list of (date, cashflow) tuples. Negative = cash out, positive = cash in.
    Returns annualized rate as a decimal (e.g. 0.12 for 12%), or None if fails.
    """
    if not flows or len(flows) < 2:
        return None

    dates, amounts = zip(*flows)
    d0 = min(dates)
    # Convert dates to year fractions
    years = [(d - d0).days / 365.25 for d in dates]

    rate = guess
    for _ in range(200):
        npv = sum(a / (1.0 + rate) ** y for a, y in zip(amounts, years))
        dnpv = sum(-y * a / (1.0 + rate) ** (y + 1) for a, y in zip(amounts, years))
        if abs(dnpv) < 1e-12:
            break
        new_rate = rate - npv / dnpv
        if abs(new_rate - rate) < 1e-9:
            rate = new_rate
            break
        rate = new_rate
        # Guard against divergence
        if rate < -0.999 or rate > 100:
            return None

    # Validate result
    if rate != rate or rate < -0.999 or rate > 100:  # NaN guard
        return None
    return rate


# ── XIRR wrapper (try pyxirr first, fallback to pure Python) ────────────────

def _calc_xirr(flows: list[tuple[datetime.date, float]], terminal_value: float = 0.0) -> float | None:
    """
    Calculate XIRR. Returns percentage (e.g. 12.5 for 12.5%).
    Tries pyxirr first, falls back to pure-Python Newton-Raphson.
    """
    if not flows:
        return None

    today = datetime.date.today()
    all_flows = flows + [(today, terminal_value)]

    # Try pyxirr (fast, Rust-based)
    try:
        from pyxirr import xirr as pyxirr_xirr
        result = pyxirr_xirr(all_flows)
        if result is not None and result == result:  # NaN guard
            return float(result) * 100
    except Exception:
        pass

    # Fallback to pure Python
    try:
        result = _xirr_pure(all_flows)
        if result is not None:
            return result * 100
    except Exception:
        pass

    return None


# ── Main analysis function ──────────────────────────────────────────────────

def analyze_cas(pdf_bytes: bytes, password: str) -> dict:
    """
    Parse a CAS PDF and return a full analysis result dict.

    Args:
        pdf_bytes: Raw PDF file content as bytes.
        password: PDF password (usually PAN in lowercase).

    Returns:
        dict with keys: status, data (summary, year_data, fund_data, top_funds, worst_funds)

    Raises:
        ValueError: If the PDF cannot be parsed or has unexpected structure.
    """
    import casparser

    parsed_raw = casparser.read_cas_pdf(io.BytesIO(pdf_bytes), password)

    # Normalize to dict (Pydantic model or plain dict)
    if hasattr(parsed_raw, "model_dump"):
        parsed = parsed_raw.model_dump(mode='json')
    elif hasattr(parsed_raw, "dict"):
        parsed = parsed_raw.dict()
    else:
        parsed = parsed_raw

    if not isinstance(parsed, dict) or "folios" not in parsed:
        raise ValueError("Unexpected CAS structure — no folios found.")

    # ── Aggregation buckets ──────────────────────────────────────────────

    total_invested = 0.0
    total_withdrawn = 0.0
    total_dividends = 0.0
    total_switch_in = 0.0
    total_switch_out = 0.0
    current_value = 0.0
    total_sip = 0.0
    total_lumpsum = 0.0
    all_flows: list[tuple[datetime.date, float]] = []

    fy_data: dict[str, dict] = defaultdict(lambda: {
        "invested": 0.0, "withdrawn": 0.0, "dividends": 0.0,
        "switch_in": 0.0, "switch_out": 0.0,
        "sip": 0.0, "lumpsum": 0.0, "txns": []
    })

    funds: dict[str, dict] = {}

    # Transaction type classification sets
    PURCHASE_TYPES = {"PURCHASE", "PURCHASE_SIP"}
    REDEEM_TYPES = {"REDEMPTION"}
    SWITCH_IN_TYPES = {"SWITCH_IN", "SWITCH_IN_MERGER"}
    SWITCH_OUT_TYPES = {"SWITCH_OUT", "SWITCH_OUT_MERGER"}
    DIVIDEND_TYPES = {"DIVIDEND_PAYOUT", "DIVIDEND_REINVEST"}
    TAX_TYPES = {"STT_TAX", "STAMP_DUTY_TAX", "TDS_TAX"}

    # ── Walk every folio → scheme → transaction ──────────────────────────

    for folio in parsed.get("folios", []):
        for scheme in folio.get("schemes", []):
            s_name = (scheme.get("scheme", "Unknown Fund")
                      if isinstance(scheme, dict)
                      else getattr(scheme, "scheme", "Unknown Fund"))

            val_obj = (scheme.get("valuation", {})
                       if isinstance(scheme, dict)
                       else getattr(scheme, "valuation", {}))
            sv = safe_float(
                val_obj.get("value", 0.0)
                if isinstance(val_obj, dict)
                else getattr(val_obj, "value", 0.0)
            )
            current_value += sv

            if s_name not in funds:
                funds[s_name] = {
                    "fresh_invested": 0.0, "switch_in_amt": 0.0,
                    "current_value": 0.0, "redeemed": 0.0, "switched_out": 0.0,
                    "flows": [], "sip": 0.0, "lumpsum": 0.0,
                    "fy_data": defaultdict(lambda: {
                        "invested": 0.0, "withdrawn": 0.0, "dividends": 0.0,
                        "sip": 0.0, "lumpsum": 0.0, "net": 0.0
                    })
                }
            funds[s_name]["current_value"] += sv

            txns = (scheme.get("transactions", [])
                    if isinstance(scheme, dict)
                    else getattr(scheme, "transactions", []))

            for txn in txns:
                amt_raw = txn.get("amount") if isinstance(txn, dict) else getattr(txn, "amount", None)
                dt_raw = txn.get("date") if isinstance(txn, dict) else getattr(txn, "date", None)
                units_raw = txn.get("units") if isinstance(txn, dict) else getattr(txn, "units", None)
                txn_type_raw = txn.get("type", "") if isinstance(txn, dict) else getattr(txn, "type", "")
                if hasattr(txn_type_raw, 'value'):
                    txn_type = txn_type_raw.value
                else:
                    txn_type = str(txn_type_raw) if txn_type_raw else ""
                nav_raw = txn.get("nav") if isinstance(txn, dict) else getattr(txn, "nav", None)

                if amt_raw is None or dt_raw is None:
                    continue

                amt = safe_float(amt_raw)
                dt = to_date(dt_raw)
                if dt is None:
                    continue

                units = safe_float(units_raw)
                nav = safe_float(nav_raw)
                fy = financial_year(dt)

                # ── Classify transaction ─────────────────────────────────
                if txn_type in PURCHASE_TYPES:
                    total_invested += amt
                    funds[s_name]["fresh_invested"] += amt
                    fy_data[fy]["invested"] += amt
                    funds[s_name]["fy_data"][fy]["invested"] += amt
                    funds[s_name]["fy_data"][fy]["net"] += amt
                    if txn_type == "PURCHASE_SIP":
                        total_sip += amt
                        fy_data[fy]["sip"] += amt
                        funds[s_name]["sip"] += amt
                        funds[s_name]["fy_data"][fy]["sip"] += amt
                    else:
                        total_lumpsum += amt
                        fy_data[fy]["lumpsum"] += amt
                        funds[s_name]["lumpsum"] += amt
                        funds[s_name]["fy_data"][fy]["lumpsum"] += amt
                    all_flows.append((dt, -amt))
                    funds[s_name]["flows"].append((dt, -amt))

                elif txn_type in REDEEM_TYPES:
                    total_withdrawn += abs(amt)
                    fy_data[fy]["withdrawn"] += abs(amt)
                    funds[s_name]["redeemed"] += abs(amt)
                    funds[s_name]["fy_data"][fy]["withdrawn"] += abs(amt)
                    funds[s_name]["fy_data"][fy]["net"] -= abs(amt)
                    all_flows.append((dt, -amt))
                    funds[s_name]["flows"].append((dt, -amt))

                elif txn_type in SWITCH_IN_TYPES:
                    total_switch_in += amt
                    fy_data[fy]["switch_in"] += amt
                    funds[s_name]["switch_in_amt"] += amt
                    funds[s_name]["fy_data"][fy]["invested"] += amt
                    funds[s_name]["fy_data"][fy]["net"] += amt
                    all_flows.append((dt, -amt))
                    funds[s_name]["flows"].append((dt, -amt))

                elif txn_type in SWITCH_OUT_TYPES:
                    total_switch_out += abs(amt)
                    fy_data[fy]["switch_out"] += abs(amt)
                    funds[s_name]["switched_out"] += abs(amt)
                    funds[s_name]["fy_data"][fy]["withdrawn"] += abs(amt)
                    funds[s_name]["fy_data"][fy]["net"] -= abs(amt)
                    all_flows.append((dt, -amt))
                    funds[s_name]["flows"].append((dt, -amt))

                elif txn_type in DIVIDEND_TYPES:
                    total_dividends += abs(amt)
                    fy_data[fy]["dividends"] += abs(amt)
                    funds[s_name]["fy_data"][fy]["dividends"] += abs(amt)
                    if txn_type == "DIVIDEND_PAYOUT" and amt < 0:
                        all_flows.append((dt, abs(amt)))
                        funds[s_name]["flows"].append((dt, abs(amt)))

                elif txn_type in TAX_TYPES:
                    pass

                else:
                    if amt != 0:
                        all_flows.append((dt, -amt))
                        funds[s_name]["flows"].append((dt, -amt))

                # Store transaction summary (NO PII)
                fy_data[fy]["txns"].append({
                    "scheme": s_name,
                    "date": dt.isoformat(),
                    "type": txn_type,
                    "amount": round(amt, 2),
                    "units": round(units, 4) if units else None,
                    "nav": round(nav, 4) if nav else None,
                })

    # ── XIRR calculation ─────────────────────────────────────────────────

    overall_xirr = _calc_xirr(all_flows, current_value)

    # ── Per-fund results ─────────────────────────────────────────────────

    fund_list = []
    for fname, fd in funds.items():
        total_cost = fd["fresh_invested"] + fd["switch_in_amt"]
        if total_cost <= 0:
            continue
        cv = fd["current_value"]
        gain = cv + sum(amt for _, amt in fd["flows"])
        fxirr = _calc_xirr(fd["flows"], cv)
        abs_ret = (gain / total_cost * 100) if total_cost > 0 else 0.0

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
                "net": round(f_fy["net"], 2),
            })

        fund_list.append({
            "name": fname,
            "invested": round(total_cost, 2),
            "fresh_invested": round(fd["fresh_invested"], 2),
            "switch_in_amt": round(fd["switch_in_amt"], 2),
            "current_value": round(cv, 2),
            "gain": round(gain, 2),
            "abs_return": round(abs_ret, 2),
            "xirr": round(fxirr, 2) if fxirr is not None else None,
            "redeemed": round(fd["redeemed"], 2),
            "switched_out": round(fd["switched_out"], 2),
            "sip": round(fd["sip"], 2),
            "lumpsum": round(fd["lumpsum"], 2),
            "fy_data": fund_fy_list,
        })
    fund_list.sort(key=lambda x: x["current_value"], reverse=True)

    # ── Year-wise summary ────────────────────────────────────────────────

    sorted_fys = sorted(fy_data.keys(), key=fy_sort_key)
    cumulative_invested = 0.0
    year_list = []

    for fy in sorted_fys:
        fd = fy_data[fy]
        inv = fd["invested"]
        wdw = fd["withdrawn"]
        div = fd["dividends"]
        sw_i = fd["switch_in"]
        sw_o = fd["switch_out"]
        cumulative_invested += inv
        net_year = inv - wdw

        fd["txns"].sort(key=lambda t: t["date"])

        year_list.append({
            "fy": fy,
            "invested": round(inv, 2),
            "withdrawn": round(wdw, 2),
            "dividends": round(div, 2),
            "switch_in": round(sw_i, 2),
            "switch_out": round(sw_o, 2),
            "sip": round(fd["sip"], 2),
            "lumpsum": round(fd["lumpsum"], 2),
            "net": round(net_year, 2),
            "cumulative_invested": round(cumulative_invested, 2),
            "txn_count": len(fd["txns"]),
            "txns": fd["txns"],
        })

    # ── Summary totals ───────────────────────────────────────────────────

    total_gains = (current_value + total_withdrawn) - total_invested
    abs_return = (total_gains / total_invested * 100) if total_invested > 0 else 0.0
    num_funds = len([f for f in fund_list if f["current_value"] > 0])
    num_years = len(year_list)

    valid_funds = [f for f in fund_list if f["xirr"] is not None and f["invested"] > 1000]
    top_funds = sorted(valid_funds, key=lambda x: x["xirr"], reverse=True)[:5]
    worst_funds = sorted(valid_funds, key=lambda x: x["xirr"])[:5]

    return {
        "status": "success",
        "data": {
            "summary": {
                "total_invested": round(total_invested, 2),
                "current_value": round(current_value, 2),
                "total_withdrawn": round(total_withdrawn, 2),
                "total_dividends": round(total_dividends, 2),
                "total_gains": round(total_gains, 2),
                "abs_return_pct": round(abs_return, 2),
                "overall_xirr": round(overall_xirr, 2) if overall_xirr is not None else None,
                "num_funds": num_funds,
                "num_years": num_years,
                "total_sip": round(total_sip, 2),
                "total_lumpsum": round(total_lumpsum, 2),
            },
            "year_data": year_list,
            "fund_data": fund_list[:50],
            "top_funds": top_funds,
            "worst_funds": worst_funds,
        }
    }
