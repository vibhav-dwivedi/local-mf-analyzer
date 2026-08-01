/**
 * xirr.js — Pure JavaScript XIRR (Extended Internal Rate of Return) calculation.
 * Uses Newton-Raphson method with bisection fallback.
 */

window.MFXirr = (function () {
    /**
     * Compute XIRR for a list of cashflows.
     * @param {Array<{date: Date, amount: number}>} flows - Negative for investment, positive for redemptions/current value
     * @param {number} [guess=0.1] - Initial guess rate
     * @returns {number|null} XIRR as percentage (e.g. 14.5 for 14.5%) or null if fails
     */
    function calculate(flows, guess = 0.1) {
        if (!flows || flows.length < 2) return null;

        const dates = flows.map(f => f.date instanceof Date ? f.date : new Date(f.date));
        const amounts = flows.map(f => f.amount);

        const d0 = new Date(Math.min(...dates.map(d => d.getTime())));
        const years = dates.map(d => (d.getTime() - d0.getTime()) / (1000 * 60 * 60 * 24 * 365.25));

        // Newton-Raphson iteration
        let rate = guess;
        const maxIter = 100;
        const tol = 1e-7;

        for (let i = 0; i < maxIter; i++) {
            let npv = 0;
            let dnpv = 0;

            for (let j = 0; j < flows.length; j++) {
                const a = amounts[j];
                const y = years[j];
                const factor = Math.pow(1 + rate, y);

                if (isNaN(factor) || factor === 0) break;

                npv += a / factor;
                dnpv -= (y * a) / (factor * (1 + rate));
            }

            if (Math.abs(npv) < tol) {
                const pctVal = rate * 100;
                return isFinite(pctVal) && pctVal > -100 && pctVal < 10000 ? parseFloat(pctVal.toFixed(2)) : null;
            }

            if (Math.abs(dnpv) < 1e-12) break;

            const newRate = rate - npv / dnpv;

            if (Math.abs(newRate - rate) < tol) {
                const pctVal = newRate * 100;
                return isFinite(pctVal) && pctVal > -100 && pctVal < 10000 ? parseFloat(pctVal.toFixed(2)) : null;
            }

            rate = newRate;
            if (rate <= -0.99) rate = -0.9;
        }

        // Bisection method fallback if Newton-Raphson fails to converge
        return bisection(amounts, years);
    }

    function bisection(amounts, years) {
        let low = -0.99;
        let high = 5.0; // 500%
        const tol = 1e-5;

        for (let i = 0; i < 100; i++) {
            const mid = (low + high) / 2;
            let npv = 0;

            for (let j = 0; j < amounts.length; j++) {
                npv += amounts[j] / Math.pow(1 + mid, years[j]);
            }

            if (Math.abs(npv) < tol) {
                const pctVal = mid * 100;
                return isFinite(pctVal) ? parseFloat(pctVal.toFixed(2)) : null;
            }

            let npvLow = 0;
            for (let j = 0; j < amounts.length; j++) {
                npvLow += amounts[j] / Math.pow(1 + low, years[j]);
            }

            if (npv * npvLow < 0) {
                high = mid;
            } else {
                low = mid;
            }
        }

        return null;
    }

    return { calculate };
})();
