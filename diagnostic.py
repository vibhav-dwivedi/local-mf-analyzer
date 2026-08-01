#!/usr/bin/env python3
"""
diagnostic.py — Run this to see exactly what casparser returns for your PDF.
Usage: python3 diagnostic.py <path_to_pdf> <password>
"""
import sys, io, json
from decimal import Decimal
import datetime

def safe_float(v):
    if v is None: return 0.0
    try: return float(v)
    except: return 0.0

if len(sys.argv) < 3:
    print("Usage: python3 diagnostic.py <path_to_pdf> <password>")
    sys.exit(1)

pdf_path = sys.argv[1]
password  = sys.argv[2]

import casparser
with open(pdf_path, "rb") as f:
    data = casparser.read_cas_pdf(f, password)

print("=== TOP-LEVEL TYPE ===")
print(type(data))
print(dir(data))

if hasattr(data, 'model_dump'):
    parsed = data.model_dump()
elif hasattr(data, 'dict'):
    parsed = data.dict()
else:
    parsed = data

print("\n=== PARSED TYPE ===", type(parsed))
if not isinstance(parsed, dict):
    print("NOT A DICT — raw:", str(parsed)[:500])
    sys.exit(1)

print("TOP KEYS:", list(parsed.keys()))
folios = parsed.get("folios", [])
print(f"\nFOLIOS: {len(folios)} found")

for fi, folio in enumerate(folios[:2]):
    print(f"\n--- Folio {fi} keys: {list(folio.keys())}")
    schemes = folio.get("schemes", [])
    print(f"  Schemes: {len(schemes)}")
    for si, scheme in enumerate(schemes[:2]):
        print(f"\n  -- Scheme {si}: {scheme.get('scheme', '?')}")
        print(f"     keys: {list(scheme.keys())}")
        val = scheme.get("valuation", {})
        print(f"     valuation: {val}")
        txns = scheme.get("transactions", [])
        print(f"     txns: {len(txns)}")
        for ti, txn in enumerate(txns[:3]):
            print(f"     txn {ti}: type={type(txn).__name__} keys={list(txn.keys()) if isinstance(txn, dict) else 'NOT DICT'}")
            if isinstance(txn, dict):
                amt = txn.get("amount")
                dt  = txn.get("date")
                tt  = txn.get("type")
                print(f"       amount={amt!r}  type={type(amt).__name__}")
                print(f"       date  ={dt!r}   type={type(dt).__name__}")
                print(f"       txtype={tt!r}   type={type(tt).__name__}")
            else:
                print(f"     >> raw txn: {txn!r}"[:200])

print("\n=== DONE ===")
