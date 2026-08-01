/**
 * cas-parser.js — Pure JavaScript parser for KFintech and myCAMS Mutual Fund CAS PDFs.
 * Uses pdf.js to extract text client-side without sending data anywhere.
 */

window.MFCasParser = (function () {

    /**
     * Helper to parse Indian financial date format (DD-MMM-YYYY, e.g. 15-Jan-2023)
     */
    function parseDate(dateStr) {
        if (!dateStr) return null;
        dateStr = dateStr.trim();
        const months = {
            jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
            jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
        };

        // Match DD-MMM-YYYY or YYYY-MM-DD
        const dmyMatch = dateStr.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})$/);
        if (dmyMatch) {
            const day = parseInt(dmyMatch[1], 10);
            const mon = months[dmyMatch[2].toLowerCase()];
            const yr = parseInt(dmyMatch[3], 10);
            if (mon !== undefined) return new Date(Date.UTC(yr, mon, day));
        }

        const isoMatch = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
        if (isoMatch) {
            return new Date(Date.UTC(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10)));
        }

        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    }

    function formatFY(dateObj) {
        if (!dateObj) return 'FY Unknown';
        const year = dateObj.getUTCFullYear();
        const month = dateObj.getUTCMonth() + 1; // 1-12
        if (month >= 4) {
            return `FY ${year}-${String(year + 1).slice(2)}`;
        } else {
            return `FY ${year - 1}-${String(year).slice(2)}`;
        }
    }

    function fySortKey(fyLabel) {
        try {
            return parseInt(fyLabel.split(' ')[1].split('-')[0], 10);
        } catch (e) {
            return 0;
        }
    }

    function cleanNum(str) {
        if (!str) return 0;
        // Strip non-numeric chars except dot and minus
        const cleaned = str.replace(/[^0-9.-]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    }

    function classifyTxnType(desc) {
        if (!desc) return 'OTHER';
        const d = desc.toUpperCase();
        if (/SIP|SYSTEMATIC INVESTMENT|SYSTEMATIC PURCHASE/i.test(d)) return 'PURCHASE_SIP';
        if (/PURCHASE|LUMPSUM|SUBSCRIPTION|ADDITIONAL PURCHASE/i.test(d)) return 'PURCHASE';
        if (/REDEMPTION|REDEEM|PAYOUT|WITHDRAWAL/i.test(d)) return 'REDEMPTION';
        if (/SWITCH\s*IN|TRANSFER\s*IN/i.test(d)) return 'SWITCH_IN';
        if (/SWITCH\s*OUT|TRANSFER\s*OUT/i.test(d)) return 'SWITCH_OUT';
        if (/DIVIDEND\s*PAYOUT/i.test(d)) return 'DIVIDEND_PAYOUT';
        if (/DIVIDEND\s*REINVEST/i.test(d)) return 'DIVIDEND_REINVEST';
        if (/STT|STAMP DUTY|TAX|TDS/i.test(d)) return 'TAX';
        return 'OTHER';
    }

    /**
     * Parse text lines extracted from pdf.js into structured folios & schemes
     */
    function parseTextLines(lines) {
        const folios = [];
        let currentFolio = null;
        let currentScheme = null;

        // Regex patterns for Indian CAS
        const folioRegex = /Folio\s*(?:No|Number)?[:\s]*([A-Za-z0-9/\s\-_]+)/i;
        const valuationRegex = /(?:Valuation|Market Value|NAV Date)[:\s]*.*?INR\s*([0-9,.]+)|Valuation\s*on\s*.*?:\s*INR\s*([0-9,.]+)/i;
        const navRegex = /NAV\s*on\s*.*?:\s*INR\s*([0-9,.]+)|NAV\s*[:\s]*INR\s*([0-9,.]+)/i;
        // Date line: 15-Jan-2023  Purchase  10,000.00  250.123  39.98
        const txnLineRegex = /^(\d{1,2}[-/][A-Za-z]{3}[-/]\d{4})\s+(.+?)\s+([-(]?[0-9,.]+\)?)\s+([-(]?[0-9,.]+\)?)\s+([-(]?[0-9,.]+\)?)/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Folio Header
            const folioMatch = line.match(folioRegex);
            if (folioMatch && !line.includes('Transaction Date')) {
                const fNo = folioMatch[1].trim();
                currentFolio = { folio: fNo, schemes: [] };
                folios.push(currentFolio);
                currentScheme = null;
                continue;
            }

            // Scheme Name (usually starts after ISIN or AMC header or includes Option/Direct/Growth)
            if (currentFolio && (/Direct|Regular|Growth|Dividend|IDCW|Fund|Plan|Option/i.test(line)) && !line.match(/^\d{1,2}[-/]/) && !line.includes('Valuation') && !line.includes('Balance')) {
                // If it looks like a scheme header line
                if (!currentScheme || currentScheme.scheme !== line) {
                    currentScheme = {
                        scheme: line,
                        valuation: { value: 0, nav: 0 },
                        transactions: []
                    };
                    currentFolio.schemes.push(currentScheme);
                }
            }

            // Scheme Valuation / NAV
            if (currentScheme) {
                const valMatch = line.match(valuationRegex);
                if (valMatch) {
                    const val = cleanNum(valMatch[1] || valMatch[2]);
                    if (val > 0) currentScheme.valuation.value = val;
                }
                const navMatch = line.match(navRegex);
                if (navMatch) {
                    const nav = cleanNum(navMatch[1] || navMatch[2]);
                    if (nav > 0) currentScheme.valuation.nav = nav;
                }
            }

            // Transaction Line
            const txnMatch = line.match(txnLineRegex);
            if (txnMatch && currentScheme) {
                const dateStr = txnMatch[1];
                const desc = txnMatch[2].trim();
                const amt = cleanNum(txnMatch[3]);
                const units = cleanNum(txnMatch[4]);
                const nav = cleanNum(txnMatch[5]);

                const txnType = classifyTxnType(desc);

                currentScheme.transactions.push({
                    date: dateStr,
                    description: desc,
                    type: txnType,
                    amount: amt,
                    units: units,
                    nav: nav
                });
            }
        }

        return { folios };
    }

    /**
     * Main parse entry point using pdf.js
     * @param {ArrayBuffer} arrayBuffer - Raw PDF bytes
     * @param {string} password - PDF password
     * @param {Function} [onProgress] - Progress callback
     */
    async function parsePDF(arrayBuffer, password, onProgress) {
        if (!window.pdfjsLib) {
            throw new Error('pdf.js library is not loaded');
        }

        // Set worker src if needed
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        if (onProgress) onProgress(1, 'Decrypting PDF…');

        let loadingTask;
        try {
            loadingTask = pdfjsLib.getDocument({
                data: new Uint8Array(arrayBuffer),
                password: password || ''
            });
        } catch (e) {
            throw new Error('Invalid PDF or incorrect password');
        }

        const pdf = await loadingTask.promise.catch(err => {
            if (err.name === 'PasswordException' || err.name === 'IncorrectPasswordException') {
                throw new Error('Incorrect PDF password. Usually it is your PAN in lowercase (e.g. abcde1234f).');
            }
            throw new Error('Failed to open PDF: ' + err.message);
        });

        const totalPages = pdf.numPages;
        const textLines = [];

        for (let p = 1; p <= totalPages; p++) {
            if (onProgress) onProgress(2 + Math.floor((p / totalPages) * 3), `Extracting text from page ${p} of ${totalPages}…`);
            const page = await pdf.getPage(p);
            const textContent = await page.getTextContent();

            // Sort text items by vertical position Y (top to bottom), then horizontal X (left to right)
            const items = textContent.items.map(item => ({
                str: item.str,
                x: item.transform[4],
                y: item.transform[5]
            }));

            // Group items into line strings based on Y coordinates
            items.sort((a, b) => b.y - a.y || a.x - b.x);

            let currentLine = '';
            let lastY = null;

            for (const item of items) {
                if (lastY !== null && Math.abs(item.y - lastY) > 3) {
                    if (currentLine.trim()) textLines.push(currentLine.trim());
                    currentLine = item.str;
                } else {
                    currentLine += (currentLine ? ' ' : '') + item.str;
                }
                lastY = item.y;
            }
            if (currentLine.trim()) textLines.push(currentLine.trim());
        }

        if (onProgress) onProgress(5, 'Analyzing portfolio transactions…');

        const parsedRaw = parseTextLines(textLines);
        return aggregatePortfolio(parsedRaw);
    }

    /**
     * Convert parsed folios into dashboard ready aggregate JSON (matches analyzer.py format)
     */
    function aggregatePortfolio(parsed) {
        let totalInvested = 0;
        let totalWithdrawn = 0;
        let totalDividends = 0;
        let totalSwitchIn = 0;
        let totalSwitchOut = 0;
        let currentValue = 0;
        let totalSip = 0;
        let totalLumpsum = 0;
        const allFlows = [];

        const fyDataMap = {};
        const fundsMap = {};

        const PURCHASE_TYPES = new Set(['PURCHASE', 'PURCHASE_SIP']);
        const REDEEM_TYPES = new Set(['REDEMPTION']);
        const SWITCH_IN_TYPES = new Set(['SWITCH_IN']);
        const SWITCH_OUT_TYPES = new Set(['SWITCH_OUT']);
        const DIVIDEND_TYPES = new Set(['DIVIDEND_PAYOUT', 'DIVIDEND_REINVEST']);

        for (const folio of parsed.folios || []) {
            for (const scheme of folio.schemes || []) {
                const sName = scheme.scheme || 'Unknown Fund';
                const val = cleanNum(scheme.valuation ? scheme.valuation.value : 0);
                currentValue += val;

                if (!fundsMap[sName]) {
                    fundsMap[sName] = {
                        fresh_invested: 0, switch_in_amt: 0, current_value: 0,
                        redeemed: 0, switched_out: 0, flows: [], sip: 0, lumpsum: 0,
                        fy_data: {}
                    };
                }
                fundsMap[sName].current_value += val;

                for (const txn of scheme.transactions || []) {
                    const dt = parseDate(txn.date);
                    if (!dt) continue;

                    const amt = cleanNum(txn.amount);
                    const units = cleanNum(txn.units);
                    const nav = cleanNum(txn.nav);
                    const fy = formatFY(dt);

                    if (!fyDataMap[fy]) {
                        fyDataMap[fy] = {
                            invested: 0, withdrawn: 0, dividends: 0,
                            switch_in: 0, switch_out: 0, sip: 0, lumpsum: 0, txns: []
                        };
                    }

                    if (!fundsMap[sName].fy_data[fy]) {
                        fundsMap[sName].fy_data[fy] = { invested: 0, withdrawn: 0, dividends: 0, sip: 0, lumpsum: 0, net: 0 };
                    }

                    const tType = txn.type;

                    if (PURCHASE_TYPES.has(tType)) {
                        totalInvested += amt;
                        fundsMap[sName].fresh_invested += amt;
                        fyDataMap[fy].invested += amt;
                        fundsMap[sName].fy_data[fy].invested += amt;
                        fundsMap[sName].fy_data[fy].net += amt;

                        if (tType === 'PURCHASE_SIP') {
                            totalSip += amt;
                            fyDataMap[fy].sip += amt;
                            fundsMap[sName].sip += amt;
                            fundsMap[sName].fy_data[fy].sip += amt;
                        } else {
                            totalLumpsum += amt;
                            fyDataMap[fy].lumpsum += amt;
                            fundsMap[sName].lumpsum += amt;
                            fundsMap[sName].fy_data[fy].lumpsum += amt;
                        }
                        allFlows.push({ date: dt, amount: -amt });
                        fundsMap[sName].flows.push({ date: dt, amount: -amt });

                    } else if (REDEEM_TYPES.has(tType)) {
                        const absAmt = Math.abs(amt);
                        totalWithdrawn += absAmt;
                        fyDataMap[fy].withdrawn += absAmt;
                        fundsMap[sName].redeemed += absAmt;
                        fundsMap[sName].fy_data[fy].withdrawn += absAmt;
                        fundsMap[sName].fy_data[fy].net -= absAmt;

                        allFlows.push({ date: dt, amount: absAmt });
                        fundsMap[sName].flows.push({ date: dt, amount: absAmt });

                    } else if (SWITCH_IN_TYPES.has(tType)) {
                        totalSwitchIn += amt;
                        fyDataMap[fy].switch_in += amt;
                        fundsMap[sName].switch_in_amt += amt;
                        fundsMap[sName].fy_data[fy].invested += amt;
                        fundsMap[sName].fy_data[fy].net += amt;

                        allFlows.push({ date: dt, amount: -amt });
                        fundsMap[sName].flows.push({ date: dt, amount: -amt });

                    } else if (SWITCH_OUT_TYPES.has(tType)) {
                        const absAmt = Math.abs(amt);
                        totalSwitchOut += absAmt;
                        fyDataMap[fy].switch_out += absAmt;
                        fundsMap[sName].switched_out += absAmt;
                        fundsMap[sName].fy_data[fy].withdrawn += absAmt;
                        fundsMap[sName].fy_data[fy].net -= absAmt;

                        allFlows.push({ date: dt, amount: absAmt });
                        fundsMap[sName].flows.push({ date: dt, amount: absAmt });

                    } else if (DIVIDEND_TYPES.has(tType)) {
                        const absAmt = Math.abs(amt);
                        totalDividends += absAmt;
                        fyDataMap[fy].dividends += absAmt;
                        fundsMap[sName].fy_data[fy].dividends += absAmt;
                        if (tType === 'DIVIDEND_PAYOUT' && amt < 0) {
                            allFlows.push({ date: dt, amount: absAmt });
                            fundsMap[sName].flows.push({ date: dt, amount: absAmt });
                        }
                    } else {
                        if (amt !== 0) {
                            allFlows.push({ date: dt, amount: -amt });
                            fundsMap[sName].flows.push({ date: dt, amount: -amt });
                        }
                    }

                    fyDataMap[fy].txns.push({
                        scheme: sName,
                        date: dt.toISOString().split('T')[0],
                        type: tType,
                        amount: Math.round(amt * 100) / 100,
                        units: units ? Math.round(units * 10000) / 10000 : null,
                        nav: nav ? Math.round(nav * 10000) / 10000 : null
                    });
                }
            }
        }

        // Overall XIRR
        const today = new Date();
        const overallFlows = [...allFlows, { date: today, amount: currentValue }];
        const overallXirr = window.MFXirr ? window.MFXirr.calculate(overallFlows) : null;

        // Fund list
        const fundList = [];
        for (const [fname, fd] of Object.entries(fundsMap)) {
            const totalCost = fd.fresh_invested + fd.switch_in_amt;
            if (totalCost <= 0 && fd.current_value <= 0 && (fd.redeemed + fd.switched_out) <= 0) continue;

            const cv = fd.current_value;
            const flowSum = fd.flows.reduce((acc, f) => acc + f.amount, 0);
            const gain = cv + flowSum;
            const fundFlows = [...fd.flows, { date: today, amount: cv }];
            const fxirr = window.MFXirr ? window.MFXirr.calculate(fundFlows) : null;
            const absRet = totalCost > 0 ? (gain / totalCost) * 100 : 0;

            const fundFyList = Object.keys(fd.fy_data).sort((a, b) => fySortKey(a) - fySortKey(b)).map(fyK => {
                const fFy = fd.fy_data[fyK];
                return {
                    fy: fyK,
                    invested: Math.round(fFy.invested * 100) / 100,
                    withdrawn: Math.round(fFy.withdrawn * 100) / 100,
                    dividends: Math.round(fFy.dividends * 100) / 100,
                    sip: Math.round(fFy.sip * 100) / 100,
                    lumpsum: Math.round(fFy.lumpsum * 100) / 100,
                    net: Math.round(fFy.net * 100) / 100
                };
            });

            fundList.push({
                name: fname,
                invested: Math.round(totalCost * 100) / 100,
                fresh_invested: Math.round(fd.fresh_invested * 100) / 100,
                switch_in_amt: Math.round(fd.switch_in_amt * 100) / 100,
                current_value: Math.round(cv * 100) / 100,
                gain: Math.round(gain * 100) / 100,
                abs_return: Math.round(absRet * 100) / 100,
                xirr: fxirr,
                redeemed: Math.round(fd.redeemed * 100) / 100,
                switched_out: Math.round(fd.switched_out * 100) / 100,
                sip: Math.round(fd.sip * 100) / 100,
                lumpsum: Math.round(fd.lumpsum * 100) / 100,
                fy_data: fundFyList
            });
        }

        fundList.sort((a, b) => b.current_value - a.current_value);

        // Year summary list
        const sortedFys = Object.keys(fyDataMap).sort((a, b) => fySortKey(a) - fySortKey(b));
        let cumulativeInvested = 0;
        const yearList = [];

        for (const fy of sortedFys) {
            const fd = fyDataMap[fy];
            cumulativeInvested += fd.invested;
            const netYear = fd.invested - fd.withdrawn;

            fd.txns.sort((a, b) => a.date.localeCompare(b.date));

            yearList.push({
                fy: fy,
                invested: Math.round(fd.invested * 100) / 100,
                withdrawn: Math.round(fd.withdrawn * 100) / 100,
                dividends: Math.round(fd.dividends * 100) / 100,
                switch_in: Math.round(fd.switch_in * 100) / 100,
                switch_out: Math.round(fd.switch_out * 100) / 100,
                sip: Math.round(fd.sip * 100) / 100,
                lumpsum: Math.round(fd.lumpsum * 100) / 100,
                net: Math.round(netYear * 100) / 100,
                cumulative_invested: Math.round(cumulativeInvested * 100) / 100,
                txn_count: fd.txns.length,
                txns: fd.txns
            });
        }

        const totalGains = (currentValue + totalWithdrawn) - totalInvested;
        const absReturn = totalInvested > 0 ? (totalGains / totalInvested) * 100 : 0;
        const validFunds = fundList.filter(f => f.xirr !== null && f.invested > 1000);
        const topFunds = [...validFunds].sort((a, b) => b.xirr - a.xirr).slice(0, 5);
        const worstFunds = [...validFunds].sort((a, b) => a.xirr - b.xirr).slice(0, 5);

        return {
            summary: {
                total_invested: Math.round(totalInvested * 100) / 100,
                current_value: Math.round(currentValue * 100) / 100,
                total_withdrawn: Math.round(totalWithdrawn * 100) / 100,
                total_dividends: Math.round(totalDividends * 100) / 100,
                total_gains: Math.round(totalGains * 100) / 100,
                abs_return_pct: Math.round(absReturn * 100) / 100,
                overall_xirr: overallXirr,
                num_funds: fundList.filter(f => f.current_value > 0).length,
                num_years: yearList.length,
                total_sip: Math.round(totalSip * 100) / 100,
                total_lumpsum: Math.round(totalLumpsum * 100) / 100
            },
            year_data: yearList,
            fund_data: fundList.slice(0, 50),
            top_funds: topFunds,
            worst_funds: worstFunds
        };
    }

    return { parsePDF };
})();
