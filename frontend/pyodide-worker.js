/**
 * pyodide-worker.js — Web Worker: loads Pyodide (stdlib only, NO micropip installs)
 *                     then runs our pure-Python CAS parser on text lines from pdf.js.
 *
 * Messages IN:
 *   { type: 'init' }
 *   { type: 'analyze', textLines: string[] }
 *
 * Messages OUT:
 *   { type: 'progress', stage, message }
 *   { type: 'ready' }
 *   { type: 'result', data }
 *   { type: 'error', message }
 */

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
importScripts(PYODIDE_CDN + 'pyodide.js');

let pyodide = null;

async function initialize() {
    try {
        self.postMessage({ type: 'progress', stage: 1, message: 'Loading Python runtime…' });

        pyodide = await loadPyodide({ indexURL: PYODIDE_CDN });

        self.postMessage({ type: 'progress', stage: 2, message: 'Loading analyzer…' });

        // Fetch our custom analyzer.py (no packages needed — pure stdlib)
        const analyzerUrl = new URL('./analyzer.py', self.location.href).href;
        const resp = await fetch(analyzerUrl);
        if (!resp.ok) {
            throw new Error(`Could not fetch analyzer.py (HTTP ${resp.status})`);
        }
        const analyzerCode = await resp.text();

        pyodide.FS.writeFile('/home/pyodide/analyzer.py', analyzerCode);
        pyodide.runPython(`
import sys
if '/home/pyodide' not in sys.path:
    sys.path.insert(0, '/home/pyodide')
import analyzer
`);

        self.postMessage({ type: 'progress', stage: 3, message: 'Ready!' });
        self.postMessage({ type: 'ready' });

    } catch (err) {
        self.postMessage({ type: 'error', message: 'Failed to initialize: ' + err.message });
    }
}

async function analyze(textLines) {
    if (!pyodide) {
        self.postMessage({ type: 'error', message: 'Pyodide not initialized' });
        return;
    }
    try {
        const linesJson = JSON.stringify(textLines);
        const resultJson = pyodide.runPython(`
import json
result = analyzer.analyze_text_lines(${JSON.stringify(linesJson)})
result
`);
        const data = JSON.parse(resultJson);
        self.postMessage({ type: 'result', data });
    } catch (err) {
        self.postMessage({ type: 'error', message: 'Analysis failed: ' + err.message });
    }
}

self.onmessage = async (e) => {
    const { type, textLines } = e.data;
    switch (type) {
        case 'init': await initialize(); break;
        case 'analyze': await analyze(textLines); break;
        default: self.postMessage({ type: 'error', message: 'Unknown type: ' + type });
    }
};
