"""
Refactored FastAPI backend — now imports analysis logic from analyzer.py.
This is kept for local development / power users who prefer running a server.
"""

import io
import os
import traceback
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Import from the shared analyzer module
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from analyzer import analyze_cas

app = FastAPI(title="Mutual Fund Analyzer API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/upload")
async def upload_cas(
    file: UploadFile = File(...),
    password: str = Form(...)
):
    try:
        # Validate file type
        if file.content_type and file.content_type != "application/pdf":
            raise HTTPException(status_code=400, detail="Only PDF files are accepted.")
        if file.filename and not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only .pdf files are accepted.")

        content = await file.read()
        if len(content) < 100:
            raise HTTPException(status_code=400, detail="File is too small to be a valid CAS PDF.")

        result = analyze_cas(content, password)
        return result

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"Failed to parse CAS: {str(e)}")


# ── Static frontend ─────────────────────────────────────────────────────────

frontend_dir = os.path.join(os.path.dirname(__file__), "../frontend")
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
