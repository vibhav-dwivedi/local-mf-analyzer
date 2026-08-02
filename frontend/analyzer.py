"""
analyzer.py — Pure-Python CAS text parser (no third-party dependencies).

Receives text lines already extracted by pdf.js (JS side) and returns a
JSON-serializable portfolio analysis dict.

Input:  list of text strings (one per logical line from the PDF)
Output: dict matching the original analyzer.py schema
"""

import re
import datetime
from collections import defaultdict


# ── Helpers ──────────────────────────────────────────────────────────────────

MONTHS = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
}


def safe_float(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        cleaned = re.sub(r'[^0-9.\-]', '', str(v))
        return float(cleaned) if cleaned else 0.0
    except Exception:
        return 0.0


def parse_date(s: str) -> datetime.date | None:
    """Parse DD-Mon-YYYY (Indian CAS format) → datetime.date."""
    if not s:
        return None
    s = s.strip()
    # DD-MMM-YYYY
    m = re.match(r'^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})$', s)
    if m:
        mon = MONTHS.get(m.group(2).lower())
        if mon:
            try:
                return datetime.date(int(m.group(3)), mon, int(m.group(1)))
            except ValueError:
                return None
    # YYYY-MM-DD
    m = re.match(r'^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$', s)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def financial_year(d: datetime.date) -> str:
    if d.month >= 4:
        return f"FY {d.year}-{str(d.year + 1)[2:]}"
    return f"FY {d.year - 1}-{str(d.year)[2:]}"


def fy_sort_key(label: str) -> int:
    try:
        return int(label.split()[1].split('-')[0])
    except Exception:
        return 0


def classify_txn(desc: str) -> str:
    d = (desc or '').upper()
    if re.search(r'SIP|SYSTEMATIC\s+INVEST|SYSTEMATIC\s+PURCH', d):
        return 'PURCHASE_SIP'
    if re.search(r'PURCHASE|LUMPSUM|SUBSCRIPTION|ADDITIONAL', d):
        return 'PURCHASE'
    if re.search(r'REDEMPTION|REDEEM|PAYOUT|WITHDRAWAL', d):
        return 'REDEMPTION'
    if re.search(r'SWITCH\s*IN|TRANSFER\s*IN', d):
        return 'SWITCH_IN'
    if re.search(r'SWITCH\s*OUT|TRANSFER\s*OUT', d):
        return 'SWITCH_OUT'
    if re.search(r'DIVIDEND\s*PAYOUT', d):
        return 'DIVIDEND_PAYOUT'
    if re.search(r'DIVIDEND', d):
        return 'DIVIDEND_REINVEST'
    if re.search(r'STT|STAMP\s*DUTY|TDS', d):
        return 'TAX'
    return 'OTHER'


# ── XIRR (Newton-Raphson + bisection) ───────────────────────────────────────

def _npv(rate, amounts, years):
    return sum(a / (1 + rate) ** y for a, y in zip(amounts, years))


def _xirr_nr(amounts, years, guess=0.1, max_iter=200, tol=1e-9):
    rate = guess
    for _ in range(max_iter):
        npv = sum(a / (1 + rate) ** y for a, y in zip(amounts, years))
        dnpv = sum(-y * a / (1 + rate) ** (y + 1) for a, y in zip(amounts, years))
        if abs(dnpv) < 1e-12:
            break
        new_rate = rate - npv / dnpv
        if abs(new_rate - rate) < tol:
            rate = new_rate
            break
        rate = new_rate
        if rate < -0.999 or rate > 100:
            return None
    if rate != rate or rate < -0.999 or rate > 100:
        return None
    return rate


def _xirr_bisect(amounts, years, lo=-0.99, hi=5.0, tol=1e-6):
    npv_lo = _npv(lo, amounts, years)
    npv_hi = _npv(hi, amounts, years)
    if npv_lo * npv_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        npv_mid = _npv(mid, amounts, years)
        if abs(npv_mid) < tol:
            return mid
        if npv_lo * npv_mid < 0:
            hi = mid
        else:
            lo = mid
            npv_lo = npv_mid
    return (lo + hi) / 2


def calc_xirr(flows: list) -> float | None:
    """flows = list of (date, amount). Returns rate % or None."""
    if not flows or len(flows) < 2:
        return None
    dates, amounts = zip(*flows)
    d0 = min(dates)
    years = [(d - d0).days / 365.25 for d in dates]
    result = _xirr_nr(list(amounts), years)
    if result is None:
        result = _xirr_bisect(list(amounts), years)
    if result is None or result != result:
        return None
    pct = result * 100
    return round(pct, 2) if -100 < pct < 10000 else None


# ── Text-line cleaning ───────────────────────────────────────────────────────

SCHEME_NOISE = re.compile(
    r'ISIN\s*:\s*[A-Z0-9]+|AMC\s*:\s*[^-\n]+|Advisor\s*:\s*[^-\n]+'
    r'|Registrar\s*:\s*[^-\n]+|Folio\s*(?:No|Number)?[:\s]*[A-Za-z0-9/\s\-_]+',
    re.IGNORECASE
)
TXN_LINE_RE = re.compile(
    r'^(\d{1,2}[-/][A-Za-z]{3}[-/]\d{4})\s+(.+?)\s+([-( ]?[\d,]+\.?\d*\)?)\s+([-( ]?[\d,]+\.?\d*\)?)\s+([-( ]?[\d,]+\.?\d*\)?)$'
)
TXN_LINE_RE2 = re.compile(
    r'^(\d{1,2}[-/][A-Za-z]{3}[-/]\d{4})\s+(.+?)\s+([-( ]?[\d,]+\.?\d*\)?)$'
)
VALUATION_RE = re.compile(
    r'(?:Valuation|Market Value)[:\s]*.*?INR\s*([\d,]+\.?\d*)', re.IGNORECASE
)
NAV_RE = re.compile(
    r'NAV\s*(?:on\s*\S+\s*)?[:\s]*(?:INR\s*)?([\d,]+\.?\d*)', re.IGNORECASE
)
FOLIO_RE = re.compile(
    r'(?:Folio\s*(?:No|Number)?|Account\s*No)[:\s]*([A-Za-z0-9/\-_\s]+)',
    re.IGNORECASE
)
SCHEME_KEYWORDS = re.compile(
    r'\b(?:Direct|Regular|Growth|Dividend|IDCW|Fund|Plan|Option|Index|Equity|Debt|Balanced|Hybrid)\b',
    re.IGNORECASE
)
SKIP_LINES = re.compile(
    r'Opening Balance|Closing Balance|Transaction Date|Statement Period|Page \d|'
    r'Total|Grand Total|Folio Summary|^\s*Date\s+Description',
    re.IGNORECASE
)


def clean_scheme_name(raw: str) -> str:
    name = SCHEME_NOISE.sub('', raw).strip()
    name = re.sub(r'\s+', ' ', name).strip(' -:')
    return name if len(name) > 4 else raw.strip()


# ── Main parser ──────────────────────────────────────────────────────────────

def parse_text_lines(lines: list) -> dict:
    """Parse raw text lines from pdf.js into folios/schemes/transactions."""
    folios = []
    current_folio = None
    current_scheme = None

    for line in lines:
        line = line.strip()
        if not line or SKIP_LINES.search(line):
            continue

        # ── Folio header
        fm = FOLIO_RE.search(line)
        if fm and 'transaction' not in line.lower() and 'balance' not in line.lower():
            fno = fm.group(1).strip()
            # must look like a folio number (alphanumeric, not a long sentence)
            if len(fno) < 40 and not re.search(r'\s{3,}', fno):
                current_folio = {'folio': fno, 'schemes': []}
                folios.append(current_folio)
                current_scheme = None
                continue

        if current_folio is None:
            continue

        # ── Scheme name line
        if (SCHEME_KEYWORDS.search(line)
                and not re.match(r'^\d{1,2}[-/]', line)
                and 'valuation' not in line.lower()
                and 'balance' not in line.lower()):
            cleaned = clean_scheme_name(line)
            if len(cleaned) > 5 and (not current_scheme or current_scheme['scheme'] != cleaned):
                current_scheme = {
                    'scheme': cleaned,
                    'valuation': {'value': 0.0, 'nav': 0.0},
                    'transactions': []
                }
                current_folio['schemes'].append(current_scheme)
            continue

        if current_scheme is None:
            continue

        # ── Valuation line
        vm = VALUATION_RE.search(line)
        if vm:
            v = safe_float(vm.group(1))
            if v > 0:
                current_scheme['valuation']['value'] = v

        nvm = NAV_RE.search(line)
        if nvm:
            n = safe_float(nvm.group(1))
            if n > 0:
                current_scheme['valuation']['nav'] = n

        # ── Transaction line
        tm = TXN_LINE_RE.match(line)
        if tm:
            current_scheme['transactions'].append({
                'date': tm.group(1),
                'description': tm.group(2).strip(),
                'type': classify_txn(tm.group(2)),
                'amount': safe_float(tm.group(3)),
                'units': safe_float(tm.group(4)),
                'nav': safe_float(tm.group(5)),
            })
            continue

        tm2 = TXN_LINE_RE2.match(line)
        if tm2:
            desc = tm2.group(2).strip()
            ttype = classify_txn(desc)
            if ttype != 'OTHER' or re.search(r'Purchase|SIP|Redemption|Switch', desc, re.I):
                current_scheme['transactions'].append({
                    'date': tm2.group(1),
                    'description': desc,
                    'type': ttype,
                    'amount': safe_float(tm2.group(3)),
                    'units': 0.0,
                    'nav': 0.0,
                })

    return {'folios': folios}


# ── Portfolio aggregation ────────────────────────────────────────────────────

def aggregate(parsed: dict) -> dict:
    total_invested = total_withdrawn = total_dividends = 0.0
    total_switch_in = total_switch_out = current_value = 0.0
    total_sip = total_lumpsum = 0.0
    all_flows = []

    PURCHASE_TYPES = {'PURCHASE', 'PURCHASE_SIP'}
    REDEEM_TYPES   = {'REDEMPTION'}
    SWITCH_IN      = {'SWITCH_IN'}
    SWITCH_OUT     = {'SWITCH_OUT'}
    DIVIDEND_TYPES = {'DIVIDEND_PAYOUT', 'DIVIDEND_REINVEST'}

    fy_data = defaultdict(lambda: {
        'invested': 0.0, 'withdrawn': 0.0, 'dividends': 0.0,
        'switch_in': 0.0, 'switch_out': 0.0, 'sip': 0.0, 'lumpsum': 0.0, 'txns': []
    })
    funds = {}

    for folio in parsed.get('folios', []):
        for scheme in folio.get('schemes', []):
            sname = scheme.get('scheme', 'Unknown Fund')
            sv = safe_float((scheme.get('valuation') or {}).get('value', 0))
            current_value += sv

            if sname not in funds:
                funds[sname] = {
                    'fresh_invested': 0.0, 'switch_in_amt': 0.0,
                    'current_value': 0.0, 'redeemed': 0.0, 'switched_out': 0.0,
                    'flows': [], 'sip': 0.0, 'lumpsum': 0.0,
                    'fy_data': defaultdict(lambda: {
                        'invested': 0.0, 'withdrawn': 0.0, 'dividends': 0.0,
                        'sip': 0.0, 'lumpsum': 0.0, 'net': 0.0
                    })
                }
            funds[sname]['current_value'] += sv

            for txn in scheme.get('transactions', []):
                dt = parse_date(txn.get('date', ''))
                amt = safe_float(txn.get('amount', 0))
                if dt is None or amt == 0:
                    continue

                units = safe_float(txn.get('units', 0))
                nav   = safe_float(txn.get('nav', 0))
                ttype = txn.get('type', 'OTHER')
                fy    = financial_year(dt)

                fd = funds[sname]

                if ttype in PURCHASE_TYPES:
                    total_invested += amt
                    fd['fresh_invested'] += amt
                    fy_data[fy]['invested'] += amt
                    fd['fy_data'][fy]['invested'] += amt
                    fd['fy_data'][fy]['net'] += amt
                    if ttype == 'PURCHASE_SIP':
                        total_sip += amt
                        fy_data[fy]['sip'] += amt
                        fd['sip'] += amt
                        fd['fy_data'][fy]['sip'] += amt
                    else:
                        total_lumpsum += amt
                        fy_data[fy]['lumpsum'] += amt
                        fd['lumpsum'] += amt
                        fd['fy_data'][fy]['lumpsum'] += amt
                    all_flows.append((dt, -amt))
                    fd['flows'].append((dt, -amt))

                elif ttype in REDEEM_TYPES:
                    abs_amt = abs(amt)
                    total_withdrawn += abs_amt
                    fy_data[fy]['withdrawn'] += abs_amt
                    fd['redeemed'] += abs_amt
                    fd['fy_data'][fy]['withdrawn'] += abs_amt
                    fd['fy_data'][fy]['net'] -= abs_amt
                    all_flows.append((dt, abs_amt))
                    fd['flows'].append((dt, abs_amt))

                elif ttype in SWITCH_IN:
                    total_switch_in += amt
                    fy_data[fy]['switch_in'] += amt
                    fd['switch_in_amt'] += amt
                    fd['fy_data'][fy]['invested'] += amt
                    fd['fy_data'][fy]['net'] += amt
                    all_flows.append((dt, -amt))
                    fd['flows'].append((dt, -amt))

                elif ttype in SWITCH_OUT:
                    abs_amt = abs(amt)
                    total_switch_out += abs_amt
                    fy_data[fy]['switch_out'] += abs_amt
                    fd['switched_out'] += abs_amt
                    fd['fy_data'][fy]['withdrawn'] += abs_amt
                    fd['fy_data'][fy]['net'] -= abs_amt
                    all_flows.append((dt, abs_amt))
                    fd['flows'].append((dt, abs_amt))

                elif ttype in DIVIDEND_TYPES:
                    abs_amt = abs(amt)
                    total_dividends += abs_amt
                    fy_data[fy]['dividends'] += abs_amt
                    fd['fy_data'][fy]['dividends'] += abs_amt
                    if ttype == 'DIVIDEND_PAYOUT' and amt < 0:
                        all_flows.append((dt, abs_amt))
                        fd['flows'].append((dt, abs_amt))

                else:
                    if amt != 0:
                        all_flows.append((dt, -amt))
                        fd['flows'].append((dt, -amt))

                fy_data[fy]['txns'].append({
                    'scheme': sname,
                    'date': dt.isoformat(),
                    'type': ttype,
                    'amount': round(amt, 2),
                    'units': round(units, 4) if units else None,
                    'nav':   round(nav, 4)   if nav   else None,
                })

    today = datetime.date.today()
    overall_xirr = calc_xirr(all_flows + [(today, current_value)])

    # Fund list
    fund_list = []
    for fname, fd in funds.items():
        total_cost = fd['fresh_invested'] + fd['switch_in_amt']
        cv = fd['current_value']
        redeemed = fd['redeemed']
        switched_out = fd['switched_out']
        if total_cost <= 0 and cv <= 0 and (redeemed + switched_out) <= 0:
            continue
        gain = cv + sum(a for _, a in fd['flows'])
        abs_ret = (gain / total_cost * 100) if total_cost > 0 else 0.0
        fxirr = calc_xirr(fd['flows'] + [(today, cv)])

        fy_list = sorted(fd['fy_data'].items(), key=lambda x: fy_sort_key(x[0]))
        fund_list.append({
            'name': fname,
            'invested': round(total_cost, 2),
            'fresh_invested': round(fd['fresh_invested'], 2),
            'switch_in_amt': round(fd['switch_in_amt'], 2),
            'current_value': round(cv, 2),
            'gain': round(gain, 2),
            'abs_return': round(abs_ret, 2),
            'xirr': fxirr,
            'redeemed': round(redeemed, 2),
            'switched_out': round(switched_out, 2),
            'sip': round(fd['sip'], 2),
            'lumpsum': round(fd['lumpsum'], 2),
            'fy_data': [{
                'fy': k,
                'invested': round(v['invested'], 2),
                'withdrawn': round(v['withdrawn'], 2),
                'dividends': round(v['dividends'], 2),
                'sip': round(v['sip'], 2),
                'lumpsum': round(v['lumpsum'], 2),
                'net': round(v['net'], 2),
            } for k, v in fy_list],
        })

    fund_list.sort(key=lambda x: x['current_value'], reverse=True)

    # Year list
    sorted_fys = sorted(fy_data.keys(), key=fy_sort_key)
    cumulative = 0.0
    year_list = []
    for fy in sorted_fys:
        fd = fy_data[fy]
        inv = fd['invested']
        wdw = fd['withdrawn']
        cumulative += inv
        fd['txns'].sort(key=lambda t: t['date'])
        year_list.append({
            'fy': fy,
            'invested': round(inv, 2),
            'withdrawn': round(wdw, 2),
            'dividends': round(fd['dividends'], 2),
            'switch_in': round(fd['switch_in'], 2),
            'switch_out': round(fd['switch_out'], 2),
            'sip': round(fd['sip'], 2),
            'lumpsum': round(fd['lumpsum'], 2),
            'net': round(inv - wdw, 2),
            'cumulative_invested': round(cumulative, 2),
            'txn_count': len(fd['txns']),
            'txns': fd['txns'],
        })

    total_gains = (current_value + total_withdrawn) - total_invested
    abs_return  = (total_gains / total_invested * 100) if total_invested > 0 else 0.0
    valid_funds = [f for f in fund_list if f['xirr'] is not None and f['invested'] > 1000]

    return {
        'summary': {
            'total_invested': round(total_invested, 2),
            'current_value': round(current_value, 2),
            'total_withdrawn': round(total_withdrawn, 2),
            'total_dividends': round(total_dividends, 2),
            'total_gains': round(total_gains, 2),
            'abs_return_pct': round(abs_return, 2),
            'overall_xirr': overall_xirr,
            'num_funds': len([f for f in fund_list if f['current_value'] > 0]),
            'num_years': len(year_list),
            'total_sip': round(total_sip, 2),
            'total_lumpsum': round(total_lumpsum, 2),
        },
        'year_data': year_list,
        'fund_data': fund_list[:50],
        'top_funds': sorted(valid_funds, key=lambda x: x['xirr'], reverse=True)[:5],
        'worst_funds': sorted(valid_funds, key=lambda x: x['xirr'])[:5],
    }


# ── Entry point called from Pyodide ─────────────────────────────────────────

def analyze_text_lines(lines_json: str) -> str:
    """Accept JSON list of text lines (from pdf.js), return JSON result."""
    import json
    lines = json.loads(lines_json)
    parsed = parse_text_lines(lines)
    result = aggregate(parsed)
    return json.dumps(result)
