/**
 * pyodide-worker.js — Web Worker that runs Pyodide + CAS analysis off the main thread.
 *
 * Messages IN:
 *   { type: 'init' }                          — Load Pyodide & install packages
 *   { type: 'analyze', pdfBytes, password }   — Run analysis on PDF
 *
 * Messages OUT:
 *   { type: 'progress', stage, message }      — Loading progress updates
 *   { type: 'ready' }                         — Pyodide is loaded and ready
 *   { type: 'result', data }                  — Analysis result
 *   { type: 'error', message }                — Error occurred
 */

let pyodide = null;

// Pyodide CDN
const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';

// pyxirr WASM wheel URL (from GitHub releases)
const PYXIRR_WHEEL = 'https://github.com/Anexen/pyxirr/releases/download/v0.10.6/pyxirr-0.10.6-cp312-cp312-pyodide_2024_0_wasm32.whl';

importScripts(PYODIDE_CDN + 'pyodide.js');

// ── Analyzer Python code (embedded) ────────────────────────────────────────
// We'll fetch analyzer.py from the same origin
let analyzerCode = null;

async function initialize() {
    try {
        self.postMessage({ type: 'progress', stage: 1, message: 'Loading Python runtime…' });

        pyodide = await loadPyodide({
            indexURL: PYODIDE_CDN,
        });

        self.postMessage({ type: 'progress', stage: 2, message: 'Installing packages…' });

        // Install micropip
        await pyodide.loadPackage('micropip');
        const micropip = pyodide.pyimport('micropip');

        // Install casparser (and its dependencies)
        self.postMessage({ type: 'progress', stage: 3, message: 'Installing casparser…' });
        await micropip.install('casparser');

        // Install pyxirr WASM wheel
        self.postMessage({ type: 'progress', stage: 4, message: 'Installing pyxirr…' });
        try {
            await micropip.install(PYXIRR_WHEEL);
        } catch (e) {
            console.warn('pyxirr WASM install failed, will use pure-Python XIRR fallback:', e.message);
        }

        // Fetch and load analyzer.py
        self.postMessage({ type: 'progress', stage: 5, message: 'Loading analyzer…' });

        // Try multiple URL patterns to find analyzer.py relative to the worker location
        const workerUrl = self.location.href;
        const candidateUrls = [
            // 1. Parent directory of worker (e.g. /local-mf-analyzer/analyzer.py)
            workerUrl.substring(0, workerUrl.lastIndexOf('/frontend/')) + '/analyzer.py',
            // 2. Same directory (if copied into frontend/)
            workerUrl.substring(0, workerUrl.lastIndexOf('/')) + '/analyzer.py',
            // 3. Root path fallback
            '/analyzer.py',
            '../analyzer.py'
        ];

        for (const url of candidateUrls) {
            try {
                const resp = await fetch(url);
                if (resp.ok) {
                    analyzerCode = await resp.text();
                    console.log('Successfully loaded analyzer.py from:', url);
                    break;
                }
            } catch (e) {
                // try next URL
            }
        }

        if (analyzerCode) {
            // Write analyzer.py to Pyodide's virtual filesystem
            pyodide.FS.writeFile('/home/pyodide/analyzer.py', analyzerCode);
            // Add to Python path
            pyodide.runPython(`
import sys
if '/home/pyodide' not in sys.path:
    sys.path.insert(0, '/home/pyodide')
import analyzer
`);
        } else {
            throw new Error('Could not load analyzer.py from any location');
        }

        self.postMessage({ type: 'progress', stage: 6, message: 'Ready!' });
        self.postMessage({ type: 'ready' });

    } catch (err) {
        self.postMessage({ type: 'error', message: 'Failed to initialize: ' + err.message });
    }
}


async function analyzePDF(pdfBytes, password) {
    if (!pyodide) {
        self.postMessage({ type: 'error', message: 'Pyodide not initialized' });
        return;
    }

    try {
        // Write PDF bytes to Pyodide filesystem
        const uint8 = new Uint8Array(pdfBytes);
        pyodide.FS.writeFile('/home/pyodide/input.pdf', uint8);

        // Run analysis
        const resultJson = pyodide.runPython(`
import json

with open('/home/pyodide/input.pdf', 'rb') as f:
    pdf_bytes = f.read()

result = analyzer.analyze_cas(pdf_bytes, ${JSON.stringify(password)})
json.dumps(result)
`);

        const result = JSON.parse(resultJson);

        // Clean up temp file
        try { pyodide.FS.unlink('/home/pyodide/input.pdf'); } catch (e) { }

        self.postMessage({ type: 'result', data: result.data });

    } catch (err) {
        self.postMessage({ type: 'error', message: 'Analysis failed: ' + err.message });
    }
}


// ── Message handler ─────────────────────────────────────────────────────────

self.onmessage = async (e) => {
    const { type, pdfBytes, password } = e.data;

    switch (type) {
        case 'init':
            await initialize();
            break;
        case 'analyze':
            await analyzePDF(pdfBytes, password);
            break;
        default:
            self.postMessage({ type: 'error', message: 'Unknown message type: ' + type });
    }
};
