// lib/power.ts
//
// How long a gate needs to run before it can see the effect it is testing.
//
// A threshold written without a power calculation is not a test, it is a
// coin flip with extra steps. An external review on 2026-08-12 pointed out
// that this project's forward gate was about to schedule a false kill: the
// traded factor's own point estimate implies an expected t near 1.1 after 60
// days, so a bar set anywhere near 1.5 rejects a real edge more often than it
// confirms one. The fix is arithmetic, and it has to happen before the data
// exists, because a threshold moved afterwards is a threshold fitted.
//
// The model is the standard one-sample t-test on daily returns. For a strategy
// with daily Sharpe s observed over n days, the t-statistic is s * sqrt(n),
// and its sampling distribution is approximately normal with unit variance
// centred on that value. Everything here follows from those two facts.

/** Daily Sharpe implied by an observed t over n days. */
export function dailySharpe(observedT: number, observedDays: number): number {
  if (observedDays <= 0) return 0;
  return observedT / Math.sqrt(observedDays);
}

/** The t you should expect after `days`, if the observed effect is the truth. */
export function expectedT(observedT: number, observedDays: number, days: number): number {
  return dailySharpe(observedT, observedDays) * Math.sqrt(Math.max(days, 0));
}

/** Standard normal CDF, Abramowitz and Stegun 26.2.17, accurate to ~1e-7. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Probability that a real effect of the observed size clears `bar` after
 * `days`. This is the number that says whether a gate is a test or a lottery.
 */
export function powerAtBar(
  observedT: number,
  observedDays: number,
  days: number,
  bar: number,
): number {
  return 1 - normalCdf(bar - expectedT(observedT, observedDays, days));
}

/**
 * Days needed for `power` probability of clearing `bar`, assuming the observed
 * effect is real. Returns Infinity when the effect is zero or negative, which
 * is the honest answer: no amount of waiting confirms nothing.
 */
export function daysForPower(
  observedT: number,
  observedDays: number,
  bar: number,
  power = 0.8,
): number {
  const s = dailySharpe(observedT, observedDays);
  if (s <= 0) return Infinity;
  // Required non-centrality: the bar plus the z that leaves `power` above it.
  const z = inverseNormalCdf(power);
  const ncp = bar + z;
  if (ncp <= 0) return 0;
  return Math.ceil((ncp / s) ** 2);
}

/** Inverse standard normal, Acklam's rational approximation. */
export function inverseNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * The bar that a gate of length `days` can carry at `power`. Use this to set a
 * threshold that the effect could actually clear, rather than one that sounds
 * strict and kills real leads.
 */
export function barForPower(
  observedT: number,
  observedDays: number,
  days: number,
  power = 0.8,
): number {
  return expectedT(observedT, observedDays, days) - inverseNormalCdf(power);
}
