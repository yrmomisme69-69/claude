// End-to-end checks for the built site (docs/). Every expected number below
// is quoted from the PRISM v14 proposal (立項書).
//
//   python3 build.py
//   node tests/site.test.js            # needs the "playwright" npm package
//
// Set CHROMIUM_PATH to use a specific browser binary.

"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright");
const oracle = require("./oracle_v3.js");

const DOCS = path.resolve(__dirname, "..", "docs");
const HANS = "file://" + path.join(DOCS, "index.html");
const HANT = "file://" + path.join(DOCS, "hant", "index.html");
const SHOTS = process.env.SCREENSHOT_DIR || "";

let failures = 0;
let passes = 0;

function check(name, condition, detail) {
  if (condition) {
    passes++;
  } else {
    failures++;
    console.log("FAIL  " + name + (detail !== undefined ? "  →  " + JSON.stringify(detail) : ""));
  }
}

function equal(name, actual, expected) {
  check(name, actual === expected, { actual, expected });
}

async function cells(page, selector) {
  return page.$$eval(selector + " tr", rows =>
    rows.map(r => Array.from(r.children).map(c => c.textContent.trim())));
}

function randomV3Input() {
  const rnd = (min, max, int) => {
    const v = min + Math.random() * (max - min);
    return int ? Math.round(v) : Math.round(v * 100) / 100;
  };
  const x = {};
  for (const [k, d] of Object.entries(oracle.FIELDS)) {
    x[k] = rnd(d[1], Math.min(d[2], k === "principal" ? 6e6 : d[2]), d[3]);
  }
  x.months = rnd(1, 600, true);
  x.horizon = Math.random() < 0.3 ? x.months : rnd(1, x.months, true);
  for (const k of ["basicClawP", "basicClawM", "extraClawM", "penaltyMonthsP",
    "penaltyMonthsM", "basicPayP", "basicPayM", "extraPayM"]) {
    x[k] = rnd(0, 48, true);
  }
  if (Math.random() < 0.2) {
    x.rateP = 0;
  }
  return x;
}

(async () => {
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(HANS + "#home");
  equal("simplified lang", await page.getAttribute("html", "lang"), "zh-Hans");
  check("simplified title", (await page.title()).indexOf("直达按揭") >= 0, await page.title());
  if (SHOTS) await page.screenshot({ path: SHOTS + "/home.png", fullPage: true });

  // ---- 1. Engine parity with the original v3 calculator ----
  const inputs = Array.from({ length: 3000 }, randomV3Input);
  const ours = await page.evaluate(list => list.map(v => {
    const offer = (s, extra) => Object.assign({
      rate: v["rate" + s], fees: v["fees" + s], basic: v["basic" + s],
      basicPay: v["basicPay" + s], basicClaw: v["basicClaw" + s],
      penalty: v["penalty" + s], penaltyMonths: v["penaltyMonths" + s]
    }, extra);
    const r = calculateOffers({
      principal: v.principal, months: v.months, horizon: v.horizon,
      A: offer("P", { extra: 0.2, extraCap: 10000, extraPay: 1, extraClaw: 24 }),
      B: offer("M", { extra: v.extraM, extraCap: v.capM, extraPay: v.extraPayM, extraClaw: v.extraClawM })
    });
    const strip = o => {
      const c = Object.assign({}, o);
      delete c.early;
      return c;
    };
    return JSON.stringify({ p: strip(r.A), m: strip(r.B), held: r.held, difference: r.difference });
  }), inputs);
  let same = 0;
  inputs.forEach((x, i) => {
    if (JSON.stringify(oracle.calculateOffers(Object.assign({}, x))) === ours[i]) same++;
  });
  equal("engine identical to v3 on 3000 random inputs", same, inputs.length);

  // ---- 2. Case 2: teaching example (立項書第3章) ----
  await page.click('[data-demo="cost-teaching"] >> nth=0');
  await page.waitForSelector("#cost-result:not([hidden])");
  const exits = await cells(page, "#exit-rows");
  const expected = {
    "12": ["162,863", "223,511", "+60,648"],
    "24": ["321,936", "386,124", "+64,188"],
    "25": ["335,017", "307,690", "−27,327"],
    "36": ["477,085", "453,945", "−23,140"]
  };
  for (const row of exits) {
    const month = (row[0].match(/\d+/) || [])[0];
    if (expected[month]) {
      equal("teaching " + month + "m A", row[1], expected[month][0]);
      equal("teaching " + month + "m B", row[2], expected[month][1]);
      equal("teaching " + month + "m B−A", row[3], expected[month][2]);
      delete expected[month];
    }
    if (month === "36") {
      equal("teaching 36m A balance", row[4], "4,370,575.05");
      // The proposal computed from the unrounded balance (4,701,770.7827…);
      // the site uses the quoted 4,701,770.78, so allow one cent.
      const b = Number(row[5].replace(/,/g, ""));
      check("teaching 36m B balance", Math.abs(b - 4375196.83) <= 0.011, row[5]);
    }
  }
  equal("teaching rows all present", Object.keys(expected).length, 0);
  check("crossover at month 25", (await page.textContent("#crossover-note")).indexOf("第 25 个月起") >= 0,
    await page.textContent("#crossover-note"));
  check("chart drawn", (await page.$$("#cost-chart svg path.line")).length === 1);
  if (SHOTS) await page.screenshot({ path: SHOTS + "/cost-teaching.png", fullPage: true });

  // ---- 3. Case 4: missing clawback clause stops ranking ----
  await page.goto(HANS + "#home");
  await page.click('[data-demo="cost-missing"]');
  await page.waitForSelector("#cost-result:not([hidden])");
  check("missing clause stops ranking", (await page.textContent("#cost-title")).indexOf("已停止完整排名") >= 0,
    await page.textContent("#cost-title"));
  const missingRows = await cells(page, "#exit-rows");
  const early = missingRows.filter(r => r[0].indexOf("到期") < 0);
  check("B cost unknown before term end", early.every(r => r[2] === "未知"), early.map(r => r[2]));
  check("B cost known at maturity", missingRows[missingRows.length - 1][2] !== "未知");
  check("A cost still known", missingRows[0][1] === "162,863", missingRows[0][1]);

  // ---- 4. Old v3 export imports into the new comparison ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prism-"));
  const v1 = path.join(tmp, "v1.json");
  fs.writeFileSync(v1, JSON.stringify({
    format: "prism-core-comparison", version: 1, policy: "PRISM-v3-core",
    inputs: { principal: 4000000, months: 360, horizon: 36, rateP: 3.5, rateM: 3.5, feesP: 0, feesM: 0,
      basicP: 0.8, basicM: 0.8, extraM: 0.23, capM: 0, basicPayP: 1, basicPayM: 1, extraPayM: 1,
      basicClawP: 24, basicClawM: 24, extraClawM: 24, penaltyP: 1, penaltyM: 1,
      penaltyMonthsP: 24, penaltyMonthsM: 24 }
  }));
  await page.setInputFiles("#cost-import", v1);
  await page.waitForFunction(() => document.getElementById("cost-message").textContent.length > 0);
  check("v1 import accepted", (await page.textContent("#cost-message")).indexOf("导入成功") >= 0,
    await page.textContent("#cost-message"));
  await page.selectOption("#cost-channel", "clear");
  await page.check("#cost-confirmed");
  await page.click("#cost-form button[type=submit]");
  equal("v1 scenario result", (await page.textContent("#cost-difference")).trim(), "HK$1,200.00");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#cost-export")]);
  const v2 = path.join(tmp, "v2.json");
  await download.saveAs(v2);
  const exported = JSON.parse(fs.readFileSync(v2, "utf8"));
  equal("v2 export format", exported.format + "/" + exported.version, "prism-cost-comparison/2");
  await page.setInputFiles("#cost-import", v2);
  await page.waitForFunction(() => document.getElementById("cost-message").textContent.indexOf("导入成功") >= 0);
  passes++;

  // ---- 5. Case 3: proportional clawback + LTV (立項書附錄、第6章) ----
  await page.goto(HANS + "#home");
  await page.click('[data-demo="offer-example"]');
  const clawRows = await cells(page, "#of-rows");
  equal("clawback on 400k prepayment", clawRows[1][1], "HK$800.00");
  equal("clawback on full exit month 18", clawRows[2][1], "HK$7,200.00");
  equal("customer keeps nothing", clawRows[2][3], "HK$0.00");
  const ltv = await page.textContent("#ltv-summary");
  check("LTV 67.40%", ltv.indexOf("67.40%") >= 0 && ltv.indexOf("44,000.00") >= 0, ltv);
  if (SHOTS) await page.screenshot({ path: SHOTS + "/offer.png", fullPage: true });

  // ---- 6. Finance model (立項書第5章) ----
  await page.goto(HANS + "#finance");
  const kpis = await page.textContent("#fin-kpis");
  for (const text of ["4,900.00", "+264.28", "−180.74", "Y2", "Y4／Y4", "331.0"]) {
    check("finance KPI " + text, kpis.indexOf(text) >= 0, kpis);
  }
  const yearRows = await cells(page, "#fin-year-rows");
  equal("cumulative incl. T0", yearRows[5].slice(1).join(" "), "−331.00 −293.50 −138.50 158.50 548.50");
  const threshold = await page.textContent("#fin-threshold");
  for (const text of ["3,464.10", "72.02%", "0.40513%"]) {
    check("threshold " + text, threshold.indexOf(text) >= 0, threshold);
  }
  const sens = await cells(page, "#fin-sens-rows");
  const expectedSens = [
    ["4,900", "+264.28"], ["3,300", "−30.20"], ["3,300", "−30.20"], ["4,900", "−186.65"],
    ["4,900", "−115.60"], ["4,900", "+4.40"], ["2,900", "−103.82"], ["100", "−619.17"],
    ["3,700", "+43.42"], ["3,400", "−11.80"]
  ];
  expectedSens.forEach((e, i) => {
    equal("sensitivity " + sens[i][0], sens[i][1] + " " + sens[i][2], e[0] + " " + e[1]);
  });
  const funnel = await cells(page, "#fin-funnel-rows");
  equal("funnel conversion", funnel[0][1], "2.52%");
  equal("reach Y1..Y5", funnel[2].slice(1).map(c => c.split("（")[0]).join(" "),
    "4,000 10,000 20,000 32,000 40,000");
  const retain = await cells(page, "#fin-retain-rows");
  const need = label => (retain.filter(r => r[0] === label)[0] || [])[2] || "";
  check("retention 0.40%", need("净佣金降至0.40%").indexOf("约4（") === 0, need("净佣金降至0.40%"));
  check("retention 100-500", need("取用量改为100／200／300／400／500宗").indexOf("约15（") === 0);
  check("retention 0.40 & 60%", need("佣金0.40%且有效节佣比例60%").indexOf("约78（") === 0);
  await page.fill("#fin-alpha", "60");
  check("finance recomputes on input", (await page.textContent("#fin-kpis")).indexOf("+264.28") < 0);
  await page.click("#fin-reset");
  check("finance reset", (await page.textContent("#fin-kpis")).indexOf("+264.28") >= 0);
  if (SHOTS) await page.screenshot({ path: SHOTS + "/finance.png", fullPage: true });

  // ---- 7. Case 1: prototype app, zero external quotes → case follow-up ----
  await page.goto(HANS + "#home");
  await page.click('[data-demo="app-start"]');
  await page.click('[data-act="start"][data-type="purchase"]');
  await page.click('[data-act="need-next"]');
  check("consent required", (await page.textContent("#app-screen")).indexOf("请先同意指定用途授权") >= 0);
  await page.check("#ap-consent");
  await page.click('[data-act="need-next"]');
  check("docs step", (await page.textContent("#app-screen")).indexOf("尚余 4 项待处理") >= 0,
    await page.textContent("#app-screen"));
  while (await page.$('[data-act="doc"]')) {
    await page.click('[data-act="doc"] >> nth=0');
  }
  await page.click('[data-act="docs-next"]');
  await page.click('[data-act="issue"]');
  check("offer shows LTV", (await page.textContent("#app-screen")).indexOf("66.67%") >= 0);
  await page.click('[data-act="revise"]');
  check("revision invalidates", (await page.textContent("#app-screen")).indexOf("旧核验已失效") >= 0);
  check("next disabled until re-read", await page.isDisabled('[data-act="offer-next"]'));
  await page.check("#ap-read");
  await page.click('[data-act="offer-next"]');
  check("cost step uses v2 rate", (await page.textContent("#app-screen")).indexOf("3.55%") >= 0);
  if (SHOTS) await page.screenshot({ path: SHOTS + "/app-cost.png", fullPage: true });
  await page.check("#ap-apply");
  await page.click('[data-act="apply"]');
  for (let i = 0; i < 8; i++) {
    await page.click('[data-act="advance"]');
  }
  check("case completed", (await page.textContent("#app-screen")).indexOf("案件已完成") >= 0);
  check("offer lifecycle", (await page.textContent("#app-screen")).indexOf("追回期已届满") >= 0);
  await page.click('[data-act="restart"]');
  await page.click('[data-act="start"][data-type="refinance"]');
  await page.check("#ap-consent");
  await page.click('[data-act="need-next"]');
  await page.click('[data-act="back"]');
  await page.click('[data-act="need-next"]');
  check("refinance asks for mortgage record", (await page.textContent("#app-screen")).indexOf("现有按揭结欠") >= 0);
  // compare with external quote → prefilled cost page
  while (await page.$('[data-act="doc"]')) await page.click('[data-act="doc"] >> nth=0');
  await page.click('[data-act="docs-next"]');
  await page.click('[data-act="issue"]');
  await page.check("#ap-read");
  await page.click('[data-act="offer-next"]');
  await page.click('[data-act="compare"]');
  await page.waitForSelector('[data-route="cost"]:not([hidden])');
  equal("prefill A name", await page.inputValue("#A-name"), "PRISM 条件方案 v1");

  // ---- 8. Explanation service ----
  await page.goto(HANS + "#app");
  await page.fill("#faq-query", "优惠什么时候会被追回？");
  await page.click("#faq-ask");
  check("faq answers clawback", (await page.textContent("#faq-answer")).indexOf("7,200") >= 0,
    await page.textContent("#faq-answer"));
  await page.fill("#faq-query", "明天天气如何");
  await page.click("#faq-ask");
  check("faq refuses without source", (await page.textContent("#faq-answer")).indexOf("无来源不补写") >= 0);

  // ---- 9. Traditional page + language switching ----
  await page.goto(HANS + "#cost");
  await page.click("#lang-toggle");
  await page.waitForURL(/hant\/index\.html#cost$/);
  equal("traditional lang", await page.getAttribute("html", "lang"), "zh-Hant");
  check("traditional text", (await page.textContent("h1:visible")).indexOf("持有期成本比較") >= 0);
  await page.goto(HANS + "#finance");
  await page.waitForURL(/hant\/index\.html#finance$/);
  passes++;
  check("traditional finance", (await page.textContent("#fin-kpis")).indexOf("+264.28") >= 0);
  await page.click("#lang-toggle");
  await page.waitForURL(/docs\/index\.html#finance$/);
  equal("back to simplified", await page.getAttribute("html", "lang"), "zh-Hans");

  // ---- 10. Mobile layout: no horizontal page scroll on any page ----
  const mobile = await browser.newPage({ viewport: { width: 360, height: 780 } });
  mobile.on("pageerror", e => errors.push(e.message));
  for (const route of ["home", "proposal", "app", "cost", "offer", "finance"]) {
    await mobile.goto(HANS + "#" + route);
    if (route === "cost") {
      await mobile.check("#cost-confirmed");
      await mobile.click("#cost-form button[type=submit]");
    }
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    equal("mobile no overflow #" + route, overflow, 0);
    if (SHOTS) await mobile.screenshot({ path: SHOTS + "/mobile-" + route + ".png", fullPage: true });
  }

  equal("no page errors", errors.join(" | "), "");

  await browser.close();
  console.log(passes + " passed, " + failures + " failed");
  process.exit(failures ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
