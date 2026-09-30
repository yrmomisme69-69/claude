// Verbatim calculation engine from the original PRISM v3 page (Traditional
// Chinese, single-file calculator). Used as the reference implementation.
"use strict";
const POLICY = Object.freeze({ version: "PRISM-v3-core", extraRate: 0.20, extraCap: 10000, extraPayMonth: 1, extraClawbackMonths: 24, minimumPrincipal: 2000000, maximumPrincipal: 5000000 });
const FIELDS = Object.freeze({
  principal: ["實際取用本金（HK$）", 1, 100000000, false], months: ["供款期（月）", 1, 600, true], horizon: ["預計持有期（月）", 1, 600, true],
  rateP: ["年利率（%）", 0, 30, false], rateM: ["年利率（%）", 0, 30, false], feesP: ["全部方案費用（HK$）", 0, 10000000, false], feesM: ["全部方案費用（HK$）", 0, 10000000, false],
  basicP: ["銀行基本回贈（%）", 0, 20, false], basicM: ["銀行基本回贈（%）", 0, 20, false], extraM: ["中介額外回贈（%）", 0, 20, false], capM: ["額外回贈上限；0＝無上限（HK$）", 0, 10000000, false],
  basicPayP: ["基本回贈支付月", 0, 600, true], basicPayM: ["基本回贈支付月", 0, 600, true], extraPayM: ["中介加碼支付月", 0, 600, true],
  basicClawP: ["基本回贈追回期（月）", 0, 600, true], basicClawM: ["基本回贈追回期（月）", 0, 600, true], extraClawM: ["中介加碼追回期（月）", 0, 600, true],
  penaltyP: ["提前清還罰款（%）", 0, 20, false], penaltyM: ["提前清還罰款（%）", 0, 20, false], penaltyMonthsP: ["罰息期（月）", 0, 600, true], penaltyMonthsM: ["罰息期（月）", 0, 600, true]
});
const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
function validateInputs(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("輸入格式無效。");
  for (const key of Object.keys(values)) if (!Object.hasOwn(FIELDS, key)) throw new Error("輸入包含未支援的欄位。");
  for (const [key, definition] of Object.entries(FIELDS)) {
    const [label, min, max, integer] = definition; const value = values[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
      throw new Error(label + "須為 " + min + " 至 " + max + (integer ? " 的整數。" : " 之間的數值。"));
  }
  if (values.horizon > values.months) throw new Error("持有期不可超過供款期。");
  return values;
}
function amortize(principal, annualRate, months, held) {
  const monthlyRate = annualRate / 1200;
  const payment = monthlyRate === 0 ? principal / months : principal * monthlyRate / (-Math.expm1(-months * Math.log1p(monthlyRate)));
  let balance = principal; let interest = 0;
  for (let month = 1; month <= held; month++) { const monthlyInterest = balance * monthlyRate; interest += monthlyInterest; balance = Math.max(0, balance + monthlyInterest - payment); }
  if (held === months) balance = 0;
  return { payment, interest, balance };
}
function calculateAward(amount, payMonth, clawbackMonths, held, early) {
  amount = roundMoney(amount);
  const received = payMonth <= held ? amount : 0;
  const exitsInsidePeriod = early && clawbackMonths > 0 && held <= clawbackMonths;
  const clawback = exitsInsidePeriod ? received : 0;
  const cancelled = exitsInsidePeriod && received === 0 ? amount : 0;
  return { amount, received, clawback, cancelled, pending: Math.max(0, amount - received - cancelled), retained: received - clawback };
}
function calculatePrismExtra(principal) { return roundMoney(Math.min(principal * POLICY.extraRate / 100, POLICY.extraCap)); }
function calculateOffers(input) {
  const x = validateInputs(input); const held = x.horizon; const early = held < x.months;
  const p = amortize(x.principal, x.rateP, x.months, held); const m = amortize(x.principal, x.rateM, x.months, held);
  p.basic = calculateAward(x.principal * x.basicP / 100, x.basicPayP, x.basicClawP, held, early);
  p.extra = calculateAward(calculatePrismExtra(x.principal), POLICY.extraPayMonth, POLICY.extraClawbackMonths, held, early);
  m.basic = calculateAward(x.principal * x.basicM / 100, x.basicPayM, x.basicClawM, held, early);
  const rawBrokerExtra = x.principal * x.extraM / 100;
  const cappedBrokerExtra = x.capM > 0 ? Math.min(rawBrokerExtra, x.capM) : rawBrokerExtra;
  m.extra = calculateAward(cappedBrokerExtra, x.extraPayM, x.extraClawM, held, early);
  for (const [offer, suffix] of [[p, "P"], [m, "M"]]) {
    offer.fees = x["fees" + suffix];
    const insidePenaltyPeriod = early && held <= x["penaltyMonths" + suffix];
    offer.penalty = insidePenaltyPeriod ? offer.balance * x["penalty" + suffix] / 100 : 0;
    offer.received = offer.basic.received + offer.extra.received;
    offer.clawback = offer.basic.clawback + offer.extra.clawback;
    offer.cancelled = offer.basic.cancelled + offer.extra.cancelled;
    offer.pending = offer.basic.pending + offer.extra.pending;
    offer.retained = offer.received - offer.clawback;
    offer.cost = offer.interest + offer.fees + offer.penalty + offer.clawback - offer.received;
  }
  return { p, m, held, difference: p.cost - m.cost };
}
module.exports = { calculateOffers, FIELDS };
