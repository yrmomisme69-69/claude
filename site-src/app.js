"use strict";

// =========================================================
// PRISM 直達按揭 示範網站
//
// 兼容性：只使用 ES2015–ES2017 語法（不用 ?.、Object.hasOwn、
// 物件展開等較新寫法），讓較舊的手機、微信及國產瀏覽器也能運行。
// 全部計算在瀏覽器內完成，不上傳任何資料。
// =========================================================

// =========================================================
// 0. 通用工具
// =========================================================

const $ = id => document.getElementById(id);

const has = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const esc = value => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const roundMoney = value => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

// 與原版 v3 相同的金額格式。
const money = value => {
  return "HK$" + value.toLocaleString("en-HK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

function fmt(value, digits) {
  const d = digits === undefined ? 0 : digits;
  const text = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
  const zero = Number(text.replace(/,/g, "")) === 0;

  return (value < 0 && !zero ? "−" : "") + text;
}

// 最多保留 digits 位小數，去掉尾部的 0（例如 0.450 → 0.45）。
function trim(value, digits) {
  return fmt(value, digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function signed(value, digits) {
  const text = fmt(value, digits);
  return value > 0 && Number(text.replace(/[^\d.]/g, "")) !== 0
    ? "+" + text
    : text;
}

function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function isoDate(date) {
  const pad = n => (n < 10 ? "0" : "") + n;
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

function readNumber(id, label, min, max, integer, allowEmpty) {
  const input = $(id);
  const text = input.value.trim();

  if (text === "") {
    if (allowEmpty) {
      return null;
    }
    throw new Error("請填寫：" + label);
  }

  const value = input.valueAsNumber;

  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      label + "須為 " + min + " 至 " + max +
      (integer ? " 的整數。" : " 之間的數值。")
    );
  }

  return value;
}

// =========================================================
// 1. 頁面路由（#home、#proposal …）
// =========================================================

const ROUTES = ["home", "proposal", "app", "cost", "offer", "finance"];
let currentRoute = null;

function showRoute() {
  let route = location.hash.replace(/^#/, "");

  if (ROUTES.indexOf(route) < 0) {
    route = "home";
  }

  const sections = document.querySelectorAll("[data-route]");

  for (let i = 0; i < sections.length; i++) {
    sections[i].hidden = sections[i].getAttribute("data-route") !== route;
  }

  const links = document.querySelectorAll("[data-nav]");

  for (let i = 0; i < links.length; i++) {
    const active = links[i].getAttribute("data-nav") === route;
    links[i].className = active ? "active" : "";
    if (active) {
      links[i].setAttribute("aria-current", "page");
    } else {
      links[i].removeAttribute("aria-current");
    }
  }

  if (route !== currentRoute) {
    currentRoute = route;
    window.scrollTo(0, 0);
  }
}

window.addEventListener("hashchange", showRoute);

// 立項書目錄：在頁內捲動，不改變路由。
(function () {
  const buttons = document.querySelectorAll("[data-scroll]");

  for (let i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", () => {
      const target = $(buttons[i].getAttribute("data-scroll"));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }
})();

// 語言切換：記住選擇並保留目前頁面。
$("lang-toggle").addEventListener("click", event => {
  const target = event.currentTarget;

  try {
    localStorage.setItem("prism-lang", target.getAttribute("data-lang"));
  } catch (error) {
    // 私密模式等情況下無法儲存，仍可切換。
  }

  target.href = target.getAttribute("href").split("#")[0] + location.hash;
});

// =========================================================
// 2. 擬議政策
// 百分比採一般輸入方式：0.20 代表 0.20%，不是 20%。
// =========================================================

const POLICY = Object.freeze({
  version: "PRISM-v3-core",
  extraRate: 0.20,
  extraCap: 10000,
  extraPayMonth: 1,
  extraClawbackMonths: 24,
  minimumPrincipal: 2000000,
  maximumPrincipal: 5000000
});

// =========================================================
// 3. 持有期成本引擎（與原版 v3 計算完全相同）
// =========================================================

// 月供：P × i / [1 - (1+i)^(-n)]，i = 年利率 / 1200
function amortize(principal, annualRate, months, held) {
  const monthlyRate = annualRate / 1200;

  const payment = monthlyRate === 0
    ? principal / months
    : principal * monthlyRate /
      (-Math.expm1(-months * Math.log1p(monthlyRate)));

  let balance = principal;
  let interest = 0;

  for (let month = 1; month <= held; month++) {
    const monthlyInterest = balance * monthlyRate;

    interest += monthlyInterest;

    balance = Math.max(
      0,
      balance + monthlyInterest - payment
    );
  }

  if (held === months) {
    balance = 0;
  }

  return {
    payment,
    interest,
    balance
  };
}

// amount：核定金額；received：退出時已收到；clawback：已支付但須追回；
// cancelled：未支付但因提前退出而取消；pending：未收到且未取消；
// retained：已收並可保留。
function calculateAward(
  amount,
  payMonth,
  clawbackMonths,
  held,
  early
) {
  amount = roundMoney(amount);

  const received = payMonth <= held ? amount : 0;

  const exitsInsidePeriod =
    early &&
    clawbackMonths > 0 &&
    held <= clawbackMonths;

  const clawback = exitsInsidePeriod
    ? received
    : 0;

  const cancelled =
    exitsInsidePeriod && received === 0
      ? amount
      : 0;

  return {
    amount,
    received,
    clawback,
    cancelled,

    pending: Math.max(
      0,
      amount - received - cancelled
    ),

    retained: received - clawback
  };
}

const OFFER_KINDS = {
  prism: "PRISM 直達",
  broker: "中介渠道",
  other: "其他方案／維持原貸款"
};

// 欄位格式：[標籤、最小值、最大值、是否必須為整數]
const COMMON_FIELDS = {
  principal: ["實際取用本金（HK$）", 1, 100000000, false],
  months: ["供款期（月）", 1, 600, true],
  horizon: ["預計持有期（月）", 1, 600, true]
};

const OFFER_FIELDS = {
  rate: ["年利率（%）", 0, 30, false],
  basic: ["銀行基本回贈（%）", 0, 20, false],
  fees: ["全部方案費用（HK$）", 0, 10000000, false],
  extra: ["渠道額外回贈（%）", 0, 20, false],
  extraCap: ["額外回贈上限；0＝無上限（HK$）", 0, 10000000, false],
  basicPay: ["基本回贈支付月", 0, 600, true],
  basicClaw: ["基本回贈追回期（月）", 0, 600, true],
  extraPay: ["額外回贈支付月", 0, 600, true],
  extraClaw: ["額外回贈追回期（月）", 0, 600, true],
  penalty: ["提前清還罰款（%）", 0, 20, false],
  penaltyMonths: ["罰息期（月）", 0, 600, true]
};

const MAIN_OFFER_KEYS = ["rate", "basic", "fees", "extra", "extraCap"];
const TERM_OFFER_KEYS = [
  "basicPay", "basicClaw", "extraPay", "extraClaw",
  "penalty", "penaltyMonths"
];
const PRISM_LOCKED = {
  extra: POLICY.extraRate,
  extraCap: POLICY.extraCap,
  extraPay: POLICY.extraPayMonth,
  extraClaw: POLICY.extraClawbackMonths
};

function validateOffer(offer, name) {
  if (!offer || typeof offer !== "object" || Array.isArray(offer)) {
    throw new Error(name + "：輸入格式無效。");
  }

  for (const key of Object.keys(offer)) {
    if (!has(OFFER_FIELDS, key)) {
      throw new Error(name + "：輸入包含未支援的欄位。");
    }
  }

  for (const key of Object.keys(OFFER_FIELDS)) {
    const def = OFFER_FIELDS[key];
    const value = offer[key];

    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < def[1] ||
      value > def[2] ||
      (def[3] && !Number.isInteger(value))
    ) {
      throw new Error(
        name + "：" + def[0] + "須為 " + def[1] + " 至 " + def[2] +
        (def[3] ? " 的整數。" : " 之間的數值。")
      );
    }
  }
}

function validateCostInputs(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) {
    throw new Error("輸入格式無效。");
  }

  for (const key of Object.keys(x)) {
    if (!has(COMMON_FIELDS, key) && key !== "A" && key !== "B") {
      throw new Error("輸入包含未支援的欄位。");
    }
  }

  for (const key of Object.keys(COMMON_FIELDS)) {
    const def = COMMON_FIELDS[key];
    const value = x[key];

    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < def[1] ||
      value > def[2] ||
      (def[3] && !Number.isInteger(value))
    ) {
      throw new Error(
        def[0] + "須為 " + def[1] + " 至 " + def[2] +
        (def[3] ? " 的整數。" : " 之間的數值。")
      );
    }
  }

  validateOffer(x.A, "方案 A");
  validateOffer(x.B, "方案 B");

  if (x.horizon > x.months) {
    throw new Error("持有期不可超過供款期。");
  }

  return x;
}

// 單一方案在指定退出月份的成本。
function evaluateOffer(o, principal, months, held) {
  const early = held < months;
  const result = amortize(principal, o.rate, months, held);

  result.basic = calculateAward(
    principal * o.basic / 100,
    o.basicPay,
    o.basicClaw,
    held,
    early
  );

  const rawExtra = principal * o.extra / 100;
  const cappedExtra = o.extraCap > 0
    ? Math.min(rawExtra, o.extraCap)
    : rawExtra;

  result.extra = calculateAward(
    cappedExtra,
    o.extraPay,
    o.extraClaw,
    held,
    early
  );

  result.fees = o.fees;

  const insidePenaltyPeriod =
    early &&
    held <= o.penaltyMonths;

  result.penalty = insidePenaltyPeriod
    ? result.balance * o.penalty / 100
    : 0;

  result.received = result.basic.received + result.extra.received;
  result.clawback = result.basic.clawback + result.extra.clawback;
  result.cancelled = result.basic.cancelled + result.extra.cancelled;
  result.pending = result.basic.pending + result.extra.pending;
  result.retained = result.received - result.clawback;

  result.cost =
    result.interest +
    result.fees +
    result.penalty +
    result.clawback -
    result.received;

  result.early = early;

  return result;
}

// 雙方案計算；排名完全按計算結果，不預設任何一方勝出。
function calculateOffers(input) {
  const x = validateCostInputs(input);
  const held = x.horizon;

  const A = evaluateOffer(x.A, x.principal, x.months, held);
  const B = evaluateOffer(x.B, x.principal, x.months, held);

  return {
    A,
    B,
    held,

    // 負數：A 成本較低；正數：B 成本較低。
    difference: A.cost - B.cost
  };
}

// 條款未知時，哪些結果無法確定（未知不當零）。
function unknownImpact(unknown, result) {
  const early = result.early;
  const hasAward = result.basic.amount > 0 || result.extra.amount > 0;

  return {
    penalty: early && unknown.penalty,
    claw: early && unknown.claw && hasAward,
    cost: early && (unknown.penalty || (unknown.claw && hasAward))
  };
}

// =========================================================
// 4. 持有期成本：表單
// =========================================================

const cost = {
  source: "已載入合成示例，並非銀行實際報價",
  report: null
};

function buildCostForm() {
  const common = $("cost-common");

  for (const key of Object.keys(COMMON_FIELDS)) {
    const def = COMMON_FIELDS[key];
    common.insertAdjacentHTML(
      "beforeend",
      '<label for="c-' + key + '">' + esc(def[0]) +
      '<input id="c-' + key + '" name="' + key + '" type="number" min="' +
      def[1] + '" max="' + def[2] + '" step="' + (def[3] ? "1" : "any") +
      '" inputmode="' + (def[3] ? "numeric" : "decimal") + '" required></label>'
    );
  }

  ["A", "B"].forEach(side => {
    const card = $("offer-" + side);
    const field = key => {
      const def = OFFER_FIELDS[key];
      return '<label for="' + side + "-" + key + '">' + esc(def[0]) +
        '<input id="' + side + "-" + key + '" name="' + key +
        '" type="number" min="' + def[1] + '" max="' + def[2] +
        '" step="' + (def[3] ? "1" : "any") + '" inputmode="' +
        (def[3] ? "numeric" : "decimal") + '" required></label>';
    };

    let kinds = "";
    for (const kind of Object.keys(OFFER_KINDS)) {
      kinds += '<option value="' + kind + '">' + esc(OFFER_KINDS[kind]) + "</option>";
    }

    card.innerHTML =
      "<h2>方案 " + side + "</h2>" +
      '<div class="fields">' +
      '<label for="' + side + '-name">方案名稱<input id="' + side +
      '-name" type="text" maxlength="24"></label>' +
      '<label for="' + side + '-kind">渠道類型<select id="' + side +
      '-kind">' + kinds + "</select></label>" +
      MAIN_OFFER_KEYS.map(field).join("") +
      "</div>" +
      '<div class="notice" id="' + side + '-policy" style="margin: 14px 0 0" hidden>' +
      "<strong>擬議 PRISM 加碼：0.20%</strong><br>" +
      '<span class="small">上限 HK$10,000，銀行基本回贈另計。此月度模型在第 1 月計入加碼，提前全清追回期為 24 個月，包含第 24 月。</span>' +
      "</div>" +
      '<details style="margin-top: 14px">' +
      "<summary>支付、追回及提前清還條款</summary>" +
      '<div class="fields" style="margin-top: 12px">' +
      TERM_OFFER_KEYS.map(field).join("") +
      "</div>" +
      '<label class="check"><input type="checkbox" id="' + side +
      '-penaltyUnknown"><span>提前清還罰款條款未知（未提供或未核實）</span></label>' +
      '<label class="check"><input type="checkbox" id="' + side +
      '-clawUnknown"><span>回贈追回條款未知（未提供或未核實）</span></label>' +
      "</details>";

    $(side + "-kind").addEventListener("change", () => applyKind(side));
    $(side + "-penaltyUnknown").addEventListener("change", () => applyUnknown(side));
    $(side + "-clawUnknown").addEventListener("change", () => applyUnknown(side));
  });
}

function applyKind(side) {
  const prism = $(side + "-kind").value === "prism";

  for (const key of Object.keys(PRISM_LOCKED)) {
    const input = $(side + "-" + key);
    if (prism) {
      input.value = String(PRISM_LOCKED[key]);
    }
    input.disabled = prism;
  }

  $(side + "-policy").hidden = !prism;
  applyUnknown(side);
  updateChannelVisibility();
}

function applyUnknown(side) {
  const prism = $(side + "-kind").value === "prism";
  const penaltyUnknown = $(side + "-penaltyUnknown").checked;
  const clawUnknown = $(side + "-clawUnknown").checked;

  $(side + "-penalty").disabled = penaltyUnknown;
  $(side + "-penaltyMonths").disabled = penaltyUnknown;
  $(side + "-basicClaw").disabled = clawUnknown;
  $(side + "-extraClaw").disabled = clawUnknown || prism;
}

function updateChannelVisibility() {
  $("channel-wrap").hidden =
    $("A-kind").value !== "prism" && $("B-kind").value !== "prism";
}

function setCostState(state) {
  for (const key of Object.keys(COMMON_FIELDS)) {
    $("c-" + key).value = String(state.inputs[key]);
  }

  ["A", "B"].forEach(side => {
    $(side + "-name").value = state.names[side];
    $(side + "-kind").value = state.kinds[side];

    for (const key of Object.keys(OFFER_FIELDS)) {
      $(side + "-" + key).value = String(state.inputs[side][key]);
    }

    $(side + "-penaltyUnknown").checked = !!state.unknown[side].penalty;
    $(side + "-clawUnknown").checked = !!state.unknown[side].claw;

    applyKind(side);
  });

  $("cost-channel").value = state.channel || "clear";
}

function readCostState() {
  const inputs = {};

  for (const key of Object.keys(COMMON_FIELDS)) {
    const def = COMMON_FIELDS[key];
    inputs[key] = readNumber("c-" + key, def[0], def[1], def[2], def[3]);
  }

  const names = {};
  const kinds = {};
  const unknown = {};

  ["A", "B"].forEach(side => {
    const label = "方案 " + side + "：";
    unknown[side] = {
      penalty: $(side + "-penaltyUnknown").checked,
      claw: $(side + "-clawUnknown").checked
    };
    kinds[side] = $(side + "-kind").value;
    names[side] = $(side + "-name").value.trim() || ("方案 " + side);
    inputs[side] = {};

    for (const key of Object.keys(OFFER_FIELDS)) {
      const def = OFFER_FIELDS[key];
      const ignored =
        (unknown[side].penalty && (key === "penalty" || key === "penaltyMonths")) ||
        (unknown[side].claw && (key === "basicClaw" || key === "extraClaw"));

      if (ignored && $(side + "-" + key).value.trim() === "") {
        inputs[side][key] = 0;
      } else {
        inputs[side][key] = readNumber(
          side + "-" + key, label + def[0], def[1], def[2], def[3]
        );
      }
    }

    if (kinds[side] === "prism") {
      for (const key of Object.keys(PRISM_LOCKED)) {
        inputs[side][key] = PRISM_LOCKED[key];
      }
    }
  });

  return {
    inputs: validateCostInputs(inputs),
    names,
    kinds,
    unknown,
    channel: $("cost-channel").value
  };
}

// ---------- 示例情境 ----------

function offerTerms(values) {
  return Object.assign({
    rate: 3.5,
    basic: 0,
    fees: 0,
    extra: 0,
    extraCap: 0,
    basicPay: 1,
    basicClaw: 0,
    extraPay: 1,
    extraClaw: 0,
    penalty: 0,
    penaltyMonths: 0
  }, values);
}

function prismVersusBroker(overrides) {
  const o = overrides || {};

  const state = {
    names: { A: "PRISM 直達方案", B: "中介渠道方案" },
    kinds: { A: "prism", B: "broker" },
    unknown: { A: {}, B: {} },
    channel: "clear",
    inputs: {
      principal: 4000000,
      months: 360,
      horizon: o.horizon || 36,
      A: offerTerms({
        rate: o.rateA || 3.5,
        basic: 0.8,
        extra: POLICY.extraRate,
        extraCap: POLICY.extraCap,
        extraPay: POLICY.extraPayMonth,
        extraClaw: POLICY.extraClawbackMonths,
        basicClaw: 24,
        penalty: 1,
        penaltyMonths: 24
      }),
      B: offerTerms({
        basic: 0.8,
        extra: o.extraB === undefined ? 0.23 : o.extraB,
        extraClaw: 24,
        basicClaw: 24,
        penalty: 1,
        penaltyMonths: 24
      })
    }
  };

  return state;
}

// 立項書第3章教學例子：原貸款500萬元、30年、3.5%，已供36月。
const TEACHING_PRINCIPAL = 4701770.78;

function teachingExample(missingClaw) {
  return {
    names: { A: "A 維持原貸款", B: "B 轉按方案" },
    kinds: { A: "other", B: "other" },
    unknown: { A: {}, B: { claw: !!missingClaw } },
    channel: "clear",
    inputs: {
      principal: TEACHING_PRINCIPAL,
      months: 324,
      horizon: 36,
      A: offerTerms({ rate: 3.5 }),
      B: offerTerms({
        rate: 3.6,
        fees: 10000,
        basic: 1,
        basicPay: 0,
        basicClaw: 24,
        penalty: 1,
        penaltyMonths: 24
      })
    }
  };
}

const COST_PRESETS = {
  teaching: () => teachingExample(false),
  missing: () => teachingExample(true),
  broker: () => prismVersusBroker(),
  direct: () => prismVersusBroker({ extraB: 0.15 }),
  rate: () => prismVersusBroker({ rateA: 3.6, extraB: 0 }),
  early: () => prismVersusBroker({ horizon: 18 })
};

function loadCostPreset(name) {
  setCostState(COST_PRESETS[name]());
  cost.source = "已載入合成示例，並非銀行實際報價";
  $("cost-source").textContent = cost.source;
  $("cost-confirmed").checked = false;
  invalidateCost();
}

function invalidateCost() {
  cost.report = null;
  $("cost-result").hidden = true;
  $("cost-export").disabled = true;
  $("cost-message").textContent = "";
}

// ---------- 計算與顯示 ----------

function exitMonthsFor(inputs) {
  const list = [12, 24, 25, 36, inputs.horizon, inputs.months]
    .filter(m => m >= 1 && m <= inputs.months);

  return list
    .filter((m, i) => list.indexOf(m) === i)
    .sort((a, b) => a - b)
    .slice(0, 8);
}

function runCost(state) {
  const x = state.inputs;
  const anyPrism = state.kinds.A === "prism" || state.kinds.B === "prism";

  if (anyPrism) {
    if (
      x.principal < POLICY.minimumPrincipal ||
      x.principal > POLICY.maximumPrincipal
    ) {
      throw new Error(
        "本金超出首期擬議 HK$200萬至500萬範圍。" +
        "本版不以此加碼政策對超範圍貸款作優劣排名。"
      );
    }

    if (state.channel !== "clear") {
      throw new Error(
        "直達渠道資格未確認或存在中介轉介衝突，" +
        "請先由銀行覆核；本版暫停優惠排名。"
      );
    }
  }

  const result = calculateOffers(x);

  const exits = exitMonthsFor(x).map(month => {
    const input = Object.assign({}, x, { horizon: month });
    const r = calculateOffers(input);
    return {
      month,
      A: r.A,
      B: r.B,
      unknownA: unknownImpact(state.unknown.A, r.A),
      unknownB: unknownImpact(state.unknown.B, r.B)
    };
  });

  const series = [];
  const chartEnd = Math.min(x.months, Math.max(60, Math.min(120, x.horizon * 2)));

  for (let month = 1; month <= chartEnd; month++) {
    const input = Object.assign({}, x, { horizon: month });
    const r = calculateOffers(input);
    const uA = unknownImpact(state.unknown.A, r.A).cost;
    const uB = unknownImpact(state.unknown.B, r.B).cost;
    series.push({ x: month, y: uA || uB ? null : r.B.cost - r.A.cost });
  }

  return {
    result,
    exits,
    series,
    unknownA: unknownImpact(state.unknown.A, result.A),
    unknownB: unknownImpact(state.unknown.B, result.B)
  };
}

function renderCost(state, run) {
  const names = state.names;
  const result = run.result;
  const stopped = run.unknownA.cost || run.unknownB.cost;
  const missing = [];

  ["A", "B"].forEach(side => {
    if (state.unknown[side].penalty) {
      missing.push(names[side] + "：提前清還罰款條款未知");
    }
    if (state.unknown[side].claw) {
      missing.push(names[side] + "：回贈追回條款未知");
    }
  });

  const headline = $("cost-headline");
  headline.className = stopped ? "card result stopped" : "card result";

  if (stopped) {
    $("cost-title").textContent = "已停止完整排名：條款不完整";
    $("cost-difference").textContent = "未能比較";
    $("cost-description").textContent =
      missing.join("；") + "。未知不當作零；請向報價方取得並核實條款，或交專員處理。";
  } else {
    const difference = result.difference;
    const equal = Math.abs(difference) < 0.005;

    $("cost-title").textContent = equal
      ? "按本次輸入，兩方案淨成本相同"
      : "按本次輸入，" + (difference < 0 ? names.A : names.B) + "淨成本較低";

    $("cost-difference").textContent = money(Math.abs(difference));
    $("cost-description").textContent =
      "比較本金 " + money(state.inputs.principal) +
      "，於第 " + result.held + " 期供款後全數清還。" +
      "結果只反映輸入條款及本模型假設，不代表全市場最優方案。" +
      (missing.length ? "（" + missing.join("；") + "，但不影響此退出時間。）" : "");
  }

  // 按退出時間比較
  $("exit-head").innerHTML =
    "<tr><th>退出時間</th><th>" + esc(names.A) + " 淨成本</th><th>" +
    esc(names.B) + " 淨成本</th><th>B 減 A</th><th>" + esc(names.A) +
    " 未還本金</th><th>" + esc(names.B) + " 未還本金</th></tr>";

  const exitRows = $("exit-rows");
  clearChildren(exitRows);

  run.exits.forEach(row => {
    const unknown = row.unknownA.cost || row.unknownB.cost;
    const diff = row.B.cost - row.A.cost;
    const tr = document.createElement("tr");

    if (row.month === state.inputs.horizon) {
      tr.className = "total";
    }

    const cells = [
      ["第 " + row.month + " 個月" + (row.month === state.inputs.months ? "（到期）" : ""), ""],
      row.unknownA.cost ? ["未知", "unknown"] : [fmt(row.A.cost, 0), ""],
      row.unknownB.cost ? ["未知", "unknown"] : [fmt(row.B.cost, 0), ""],
      unknown ? ["未能比較", "unknown"] : [signed(diff, 0), diff > 0.5 ? "neg" : (diff < -0.5 ? "pos" : "")],
      [fmt(row.A.balance, 2), ""],
      [fmt(row.B.balance, 2), ""]
    ];

    cells.forEach(cell => {
      const td = document.createElement("td");
      td.textContent = cell[0];
      if (cell[1]) {
        td.className = cell[1];
      }
      tr.appendChild(td);
    });

    exitRows.appendChild(tr);
  });

  // 結論反轉
  const flips = [];
  let previous = null;

  run.series.forEach(point => {
    if (point.y === null || Math.abs(point.y) < 0.5) {
      return;
    }
    const sign = point.y > 0 ? 1 : -1;
    if (previous !== null && sign !== previous) {
      flips.push({ month: point.x, cheaper: sign > 0 ? names.A : names.B });
    }
    previous = sign;
  });

  $("crossover-note").textContent = run.series.every(p => p.y === null)
    ? "條款不完整，未能繪出提前退出的成本差距。"
    : flips.length
      ? "結論反轉：" + flips.slice(0, 3).map(f =>
        "第 " + f.month + " 個月起 " + f.cheaper + " 較低").join("；") +
        "。退出時仍須清還的本金另列，成本較低不等於所需現金較少。"
      : "在圖表範圍內，兩方案的高低次序沒有反轉。退出時仍須清還的本金另列。";

  $("cost-chart").innerHTML = lineChart(run.series, {
    height: 230,
    xLabel: "退出月份",
    zero: true
  });
  $("chart-legend").textContent =
    "B 減 A 淨成本（HK$）：高於虛線代表 " + names.A + " 較低；低於虛線代表 " + names.B + " 較低。";

  // 完整成本明細
  $("breakdown-title").textContent = "完整成本明細：第 " + result.held + " 個月退出";
  $("breakdown-head").innerHTML =
    "<tr><th>項目</th><th>" + esc(names.A) + "</th><th>" + esc(names.B) + "</th></tr>";

  const rows = [
    ["核定銀行基本回贈", v => v.basic.amount],
    ["核定渠道額外回贈", v => v.extra.amount],
    ["累計利息", v => v.interest],
    ["全部方案費用", v => v.fees],
    ["提前清還罰款", v => v.penalty, "penalty"],
    ["基本回贈已付追回", v => v.basic.clawback, "claw"],
    ["額外回贈已付追回", v => v.extra.clawback, "claw"],
    ["減：實際已收回贈", v => v.received],
    ["未付而取消；不另計成本", v => v.cancelled, "claw"],
    ["期末保留的已收回贈", v => v.retained, "claw"],
    ["淨融資成本", v => v.cost, "cost", true],
    ["每月供款", v => v.payment],
    ["期末未還本金；另列", v => v.balance]
  ];

  const tbody = $("breakdown-rows");
  clearChildren(tbody);

  rows.forEach(row => {
    const tr = document.createElement("tr");
    if (row[3]) {
      tr.className = "total";
    }

    const label = document.createElement("td");
    label.textContent = row[0];
    tr.appendChild(label);

    [[result.A, run.unknownA], [result.B, run.unknownB]].forEach(pair => {
      const td = document.createElement("td");
      const flag = row[2];
      if (flag && pair[1][flag]) {
        td.textContent = "未知";
        td.className = "unknown";
      } else {
        td.textContent = money(row[1](pair[0]));
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  const pending = result.A.pending + result.B.pending;

  $("pending-note").textContent = pending > 0
    ? "仍有尚未收到的條件回贈，未在本期成本扣除；退出後是否仍可取得，須向報價方確認。"
    : "本期成本只扣除指定時點前已實際收到的回贈。";

  $("cost-result").hidden = false;
  $("cost-export").disabled = false;
}

function calculateCostNow() {
  invalidateCost();

  try {
    const state = readCostState();

    if (!$("cost-confirmed").checked) {
      throw new Error("請先核對本次輸入及計算假設。");
    }

    const run = runCost(state);

    cost.report = {
      format: "prism-cost-comparison",
      version: 2,
      policy: POLICY.version,
      generatedAt: new Date().toISOString(),
      source: cost.source,
      names: state.names,
      kinds: state.kinds,
      unknown: state.unknown,
      channel: state.channel,
      inputs: state.inputs,
      result: run.result,
      notice: "示例／自填情境，並非銀行報價、審批或優惠承諾。"
    };

    renderCost(state, run);
    return true;
  } catch (error) {
    $("cost-message").textContent = error.message;
    return false;
  }
}

function initCost() {
  buildCostForm();

  $("cost-form").addEventListener("submit", event => {
    event.preventDefault();
    if (calculateCostNow()) {
      $("cost-result").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  $("cost-form").addEventListener("input", event => {
    const target = event.target;
    if (target.id === "cost-confirmed" || target.id === "cost-import") {
      return;
    }

    $("cost-confirmed").checked = false;
    invalidateCost();
    cost.source = "自填情境，尚待核對";
    $("cost-source").textContent = cost.source;
  });

  $("cost-form").addEventListener("change", event => {
    if (event.target.tagName === "SELECT" || event.target.type === "checkbox") {
      if (event.target.id !== "cost-confirmed") {
        $("cost-confirmed").checked = false;
        invalidateCost();
      }
    }
  });

  $("cost-confirmed").addEventListener("change", () => {
    if (!$("cost-confirmed").checked) {
      invalidateCost();
    }
  });

  const presets = document.querySelectorAll("[data-preset]");
  for (let i = 0; i < presets.length; i++) {
    presets[i].addEventListener("click", () => {
      loadCostPreset(presets[i].getAttribute("data-preset"));
    });
  }

  $("cost-export").addEventListener("click", () => {
    if (cost.report) {
      downloadJson(cost.report, "PRISM_Comparison.json", "cost-message");
    }
  });

  $("cost-import").addEventListener("change", event => {
    const input = event.target;
    const file = input.files && input.files[0];

    if (!file) {
      return;
    }

    readJsonFile(file)
      .then(data => {
        setCostState(importedCostState(data));
        cost.source = "已匯入資料，必須重新核對";
        $("cost-source").textContent = cost.source;
        $("cost-confirmed").checked = false;
        $("cost-channel").value = "unknown";
        invalidateCost();
        $("cost-message").textContent =
          "匯入成功。請重新確認渠道資格及條款，再按計算；程式不會採用檔案內原有排名。";
      })
      .catch(error => {
        $("cost-message").textContent = "匯入失敗：" + error.message;
      })
      .then(() => {
        input.value = "";
      });
  });

  loadCostPreset("teaching");
}

// 只採用驗證後的輸入；不信任檔案內的結果、排名及核對狀態。
function importedCostState(data) {
  if (!data || typeof data !== "object") {
    throw new Error("檔案格式或政策版本不相符。");
  }

  // 原版 v3（PRISM 對中介）匯出檔
  if (
    data.format === "prism-core-comparison" &&
    data.version === 1 &&
    data.policy === POLICY.version
  ) {
    const v = data.inputs || {};
    const pick = (suffix, extra) => offerTerms(Object.assign({
      rate: v["rate" + suffix],
      fees: v["fees" + suffix],
      basic: v["basic" + suffix],
      basicPay: v["basicPay" + suffix],
      basicClaw: v["basicClaw" + suffix],
      penalty: v["penalty" + suffix],
      penaltyMonths: v["penaltyMonths" + suffix]
    }, extra));

    const state = {
      names: { A: "PRISM 直達方案", B: "中介渠道方案" },
      kinds: { A: "prism", B: "broker" },
      unknown: { A: {}, B: {} },
      channel: "unknown",
      inputs: {
        principal: v.principal,
        months: v.months,
        horizon: v.horizon,
        A: pick("P", PRISM_LOCKED),
        B: pick("M", {
          extra: v.extraM,
          extraCap: v.capM,
          extraPay: v.extraPayM,
          extraClaw: v.extraClawM
        })
      }
    };

    validateCostInputs(state.inputs);
    return state;
  }

  if (
    data.format !== "prism-cost-comparison" ||
    data.version !== 2 ||
    data.policy !== POLICY.version
  ) {
    throw new Error("檔案格式或政策版本不相符。");
  }

  const kinds = data.kinds || {};
  const names = data.names || {};
  const unknown = data.unknown || {};

  ["A", "B"].forEach(side => {
    if (!has(OFFER_KINDS, kinds[side])) {
      throw new Error("渠道類型無效。");
    }
    if (typeof names[side] !== "string") {
      names[side] = "方案 " + side;
    }
    unknown[side] = unknown[side] || {};
  });

  return {
    names: { A: names.A.slice(0, 24), B: names.B.slice(0, 24) },
    kinds: { A: kinds.A, B: kinds.B },
    unknown: {
      A: { penalty: unknown.A.penalty === true, claw: unknown.A.claw === true },
      B: { penalty: unknown.B.penalty === true, claw: unknown.B.claw === true }
    },
    channel: "unknown",
    inputs: validateCostInputs(data.inputs)
  };
}

// =========================================================
// 5. JSON 匯出／匯入
// =========================================================

function downloadJson(data, filename, messageId) {
  const content = JSON.stringify(data, null, 2);
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });

  if (window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  // 微信等內置瀏覽器通常禁止下載，改為顯示內容讓用戶複製。
  if (/MicroMessenger|QQ\/|Weibo/i.test(navigator.userAgent)) {
    $(messageId).textContent =
      "如果沒有自動下載，請長按或複製以下內容，另存為 .json 檔案：\n\n" + content;
  }
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 200000) {
      reject(new Error("檔案過大，請匯入本程式輸出的 JSON。"));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (error) {
        reject(new Error("檔案無法讀取，或不是有效的 JSON。"));
      }
    };
    reader.onerror = () => reject(new Error("檔案無法讀取，或不是有效的 JSON。"));
    reader.readAsText(file, "utf-8");
  });
}

// =========================================================
// 6. 圖表（內嵌 SVG，不依賴外部程式庫）
// =========================================================

function niceStep(range, target) {
  const raw = range / target;
  const power = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  const unit = raw / power;
  const step = unit >= 5 ? 10 : unit >= 2 ? 5 : unit >= 1 ? 2 : 1;
  return step * power;
}

function axisLabel(value) {
  const abs = Math.abs(value);
  if (abs >= 10000) {
    return fmt(value / 10000, abs >= 100000 ? 0 : 1) + "萬";
  }
  return fmt(value, 0);
}

function lineChart(points, options) {
  const width = 640;
  const height = options.height || 220;
  const pad = { left: 56, right: 14, top: 12, bottom: 34 };
  const valid = points.filter(p => p.y !== null);

  if (!valid.length) {
    return "";
  }

  const xs = points.map(p => p.x);
  const ys = valid.map(p => p.y).concat(options.zero ? [0] : []);
  const xMin = Math.min.apply(null, xs);
  const xMax = Math.max.apply(null, xs);
  let yMin = Math.min.apply(null, ys);
  let yMax = Math.max.apply(null, ys);

  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }

  const step = niceStep(yMax - yMin, 4);
  yMin = Math.floor(yMin / step) * step;
  yMax = Math.ceil(yMax / step) * step;

  const sx = x => pad.left + (x - xMin) / Math.max(1, xMax - xMin) * (width - pad.left - pad.right);
  const sy = y => pad.top + (yMax - y) / (yMax - yMin) * (height - pad.top - pad.bottom);

  let svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' +
    esc(options.xLabel || "") + '">';

  for (let y = yMin; y <= yMax + step / 2; y += step) {
    svg += '<line class="axis" x1="' + pad.left + '" x2="' + (width - pad.right) +
      '" y1="' + sy(y) + '" y2="' + sy(y) + '" opacity="0.5"/>';
    svg += '<text x="' + (pad.left - 6) + '" y="' + (sy(y) + 4) +
      '" text-anchor="end">' + axisLabel(y) + "</text>";
  }

  if (options.zero && yMin < 0 && yMax > 0) {
    svg += '<line class="zero" x1="' + pad.left + '" x2="' + (width - pad.right) +
      '" y1="' + sy(0) + '" y2="' + sy(0) + '"/>';
  }

  const xStep = niceStep(xMax - xMin || 1, 6);
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
    svg += '<text x="' + sx(x) + '" y="' + (height - 12) + '" text-anchor="middle">' + x + "</text>";
  }

  let path = "";
  let open = false;

  points.forEach(p => {
    if (p.y === null) {
      open = false;
      return;
    }
    path += (open ? "L" : "M") + sx(p.x).toFixed(1) + " " + sy(p.y).toFixed(1);
    open = true;
  });

  svg += '<path class="line" d="' + path + '"/>';
  svg += '<text x="' + (width - pad.right) + '" y="' + (height - 1) +
    '" text-anchor="end">' + esc(options.xLabel || "") + "</text>";
  svg += "</svg>";

  return svg;
}

function barLineChart(bars, line, options) {
  const width = 640;
  const height = options.height || 240;
  const pad = { left: 56, right: 14, top: 12, bottom: 30 };
  const values = bars.map(b => b.y).concat(line.map(p => p.y)).concat([0]);
  let yMin = Math.min.apply(null, values);
  let yMax = Math.max.apply(null, values);

  if (yMin === yMax) {
    yMax += 1;
  }

  const step = niceStep(yMax - yMin, 4);
  yMin = Math.floor(yMin / step) * step;
  yMax = Math.ceil(yMax / step) * step;

  const slots = line.length;
  const slotWidth = (width - pad.left - pad.right) / slots;
  const cx = i => pad.left + slotWidth * (i + 0.5);
  const sy = y => pad.top + (yMax - y) / (yMax - yMin) * (height - pad.top - pad.bottom);

  let svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' +
    esc(options.label || "") + '">';

  for (let y = yMin; y <= yMax + step / 2; y += step) {
    svg += '<line class="axis" x1="' + pad.left + '" x2="' + (width - pad.right) +
      '" y1="' + sy(y) + '" y2="' + sy(y) + '" opacity="0.5"/>';
    svg += '<text x="' + (pad.left - 6) + '" y="' + (sy(y) + 4) +
      '" text-anchor="end">' + fmt(y, 0) + "</text>";
  }

  svg += '<line class="zero" x1="' + pad.left + '" x2="' + (width - pad.right) +
    '" y1="' + sy(0) + '" y2="' + sy(0) + '"/>';

  bars.forEach(bar => {
    const i = bar.slot;
    const top = sy(Math.max(0, bar.y));
    const h = Math.abs(sy(0) - sy(bar.y));
    svg += '<rect class="' + (bar.y >= 0 ? "bar-pos" : "bar-neg") + '" x="' +
      (cx(i) - slotWidth * 0.28) + '" y="' + top + '" width="' + (slotWidth * 0.56) +
      '" height="' + Math.max(1, h) + '" rx="3"/>';
  });

  let path = "";
  line.forEach((p, i) => {
    path += (i ? "L" : "M") + cx(i).toFixed(1) + " " + sy(p.y).toFixed(1);
  });
  svg += '<path class="line-2" d="' + path + '"/>';

  line.forEach((p, i) => {
    svg += '<circle cx="' + cx(i) + '" cy="' + sy(p.y) + '" r="3.5" fill="#102d46"/>';
    svg += '<text x="' + cx(i) + '" y="' + (height - 10) + '" text-anchor="middle">' +
      esc(p.label) + "</text>";
  });

  svg += "</svg>";
  return svg;
}

// =========================================================
// 7. PRISM 優惠追回及按揭成數
// =========================================================

function prismAward(principal) {
  return roundMoney(Math.min(
    principal * POLICY.extraRate / 100,
    POLICY.extraCap
  ));
}

// 期內非例行部分還本：追回＝原優惠 × 還本額 ÷ 原本金；
// 24個月內全清：追回未曾追回的已付餘額。
function calculatePrismClawback(principal, prepayments, exitMonth) {
  const award = prismAward(principal);
  const period = POLICY.extraClawbackMonths;
  const events = [];
  let clawed = 0;
  let repaid = 0;

  events.push({
    label: "取用後30曆日內支付 PRISM 加碼（模型第 1 月）",
    claw: 0,
    note: "paid"
  });

  prepayments
    .slice()
    .sort((a, b) => a.month - b.month)
    .forEach(item => {
      if (exitMonth !== null && item.month >= exitMonth) {
        throw new Error("部分還本月份須早於全清月份。");
      }

      repaid += item.amount;

      if (repaid >= principal) {
        throw new Error("部分還本合計須少於原本金；全數清還請填「全清月份」。");
      }

      const share = item.amount / principal;
      const inside = item.month <= period;
      const claw = inside
        ? Math.min(award - clawed, roundMoney(award * share))
        : 0;

      clawed = roundMoney(clawed + claw);

      events.push({
        label: "第 " + item.month + " 月部分還本 " + money(item.amount) +
          "（佔原本金 " + fmt(share * 100, 2) + "%）" +
          (inside ? "" : "：追回期已屆滿，不調整"),
        claw
      });
    });

  if (exitMonth !== null) {
    const inside = exitMonth <= period;
    const claw = inside ? roundMoney(award - clawed) : 0;
    clawed = roundMoney(clawed + claw);

    events.push({
      label: "第 " + exitMonth + " 月全清或轉按離行" +
        (inside ? "：追回未曾追回的已付餘額" : "：24 個月後全清，不追回"),
      claw
    });
  }

  let running = 0;
  events.forEach(event => {
    running = roundMoney(running + event.claw);
    event.total = running;
    event.kept = roundMoney(award - running);
  });

  return { award, clawed, kept: roundMoney(award - clawed), events };
}

function calculateLtv(loan, value, basicRate, other, includePrism) {
  const basic = roundMoney(loan * basicRate / 100);
  const prism = includePrism ? prismAward(loan) : 0;
  const total = roundMoney(basic + prism + other);
  const share = total / loan * 100;
  const exceeds = total > loan * 0.01 + 0.005;
  const ltv = (exceeds ? loan + total : loan) / value * 100;

  return { basic, prism, total, share, exceeds, ltv };
}

function addPrepayRow(month, amount) {
  const list = $("of-prepay");

  if (list.children.length >= 6) {
    return;
  }

  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    '<label>還本月份<input type="number" min="1" max="600" step="1" inputmode="numeric" data-role="month"></label>' +
    '<label>還本金額（HK$）<input type="number" min="1" step="any" inputmode="decimal" data-role="amount"></label>' +
    '<button type="button" aria-label="刪除">刪除</button>';

  row.querySelector('[data-role="month"]').value = month === undefined ? "" : String(month);
  row.querySelector('[data-role="amount"]').value = amount === undefined ? "" : String(amount);
  row.querySelector("button").addEventListener("click", () => {
    list.removeChild(row);
    renderOffer();
  });

  list.appendChild(row);
}

function renderOffer() {
  const message = $("of-message");
  message.textContent = "";

  try {
    const principal = readNumber("of-principal", "實際取用本金", 1, 100000000, false);
    const exit = readNumber("of-exit", "全清月份", 1, 600, true, true);
    const prepayments = [];
    const rows = $("of-prepay").querySelectorAll(".row");

    for (let i = 0; i < rows.length; i++) {
      const monthInput = rows[i].querySelector('[data-role="month"]');
      const amountInput = rows[i].querySelector('[data-role="amount"]');

      if (monthInput.value.trim() === "" && amountInput.value.trim() === "") {
        continue;
      }

      const month = monthInput.valueAsNumber;
      const amount = amountInput.valueAsNumber;

      if (!Number.isInteger(month) || month < 1 || month > 600) {
        throw new Error("還本月份須為 1 至 600 的整數。");
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("還本金額須大於 0。");
      }

      prepayments.push({ month, amount });
    }

    const r = calculatePrismClawback(principal, prepayments, exit);
    const raw = principal * POLICY.extraRate / 100;

    $("of-summary").innerHTML =
      "<div><dt>PRISM 加碼</dt><dd>" + money(r.award) + "</dd></div>" +
      "<div><dt>計算</dt><dd>min（" + fmt(principal, 0) + " × 0.20% ＝ " + fmt(raw, 2) +
      "，上限 10,000）</dd></div>" +
      "<div><dt>支付</dt><dd>符合資格並取用後30曆日內</dd></div>" +
      "<div><dt>追回期</dt><dd>取用日起至第 24 個月屆滿當日</dd></div>" +
      "<div><dt>累計追回</dt><dd>" + money(r.clawed) + "</dd></div>" +
      "<div><dt>客戶最終保留</dt><dd>" + money(r.kept) + "</dd></div>";

    const tbody = $("of-rows");
    clearChildren(tbody);

    r.events.forEach(event => {
      const tr = document.createElement("tr");
      [
        event.label,
        event.note === "paid" ? "支付 " + money(r.award) : money(event.claw),
        money(event.total),
        money(event.kept)
      ].forEach(text => {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  } catch (error) {
    message.textContent = error.message;
    $("of-summary").innerHTML = "";
    clearChildren($("of-rows"));
  }
}

function loadOfferExample() {
  $("of-principal").value = "4000000";
  $("of-exit").value = "18";
  clearChildren($("of-prepay"));
  addPrepayRow(12, 400000);
  renderOffer();
}

function renderLtv() {
  const message = $("ltv-message");
  message.textContent = "";

  try {
    const loan = readNumber("ltv-loan", "貸款額", 1, 100000000, false);
    const value = readNumber("ltv-value", "物業估值", 1, 1000000000, false);
    const basic = readNumber("ltv-basic", "銀行基本回贈", 0, 20, false);
    const other = readNumber("ltv-other", "其他現金回贈", 0, 10000000, false);
    const cap = readNumber("ltv-cap", "適用成數上限", 1, 100, false);
    const r = calculateLtv(loan, value, basic, other, $("ltv-prism").value === "yes");

    $("ltv-summary").innerHTML =
      "<div><dt>銀行基本回贈</dt><dd>" + money(r.basic) + "</dd></div>" +
      "<div><dt>PRISM 加碼</dt><dd>" + money(r.prism) + "</dd></div>" +
      "<div><dt>其他現金回贈</dt><dd>" + money(other) + "</dd></div>" +
      "<div><dt>回贈合計</dt><dd>" + money(r.total) + "（佔貸款額 " + fmt(r.share, 2) + "%）</dd></div>" +
      "<div><dt>成數計算</dt><dd>" + (r.exceeds
        ? "（" + fmt(loan, 0) + "＋" + fmt(r.total, 0) + "）÷ " + fmt(value, 0)
        : fmt(loan, 0) + " ÷ " + fmt(value, 0)) + "</dd></div>" +
      "<div><dt>按揭成數</dt><dd>" + fmt(r.ltv, 2) + "%</dd></div>";

    let verdict;
    if (r.ltv > cap + 1e-9) {
      verdict = '<div class="notice danger"><p><strong>超出適用上限 ' + fmt(cap, 2) +
        "%</strong>：須重新核對本金與首期並取得客戶確認，不靜默減少放款。</p></div>";
    } else if (cap - r.ltv < 1) {
      verdict = '<div class="notice warn"><p><strong>接近適用上限</strong>（差距少於 1 個百分點）：重新核對本金與首期並取得客戶確認。</p></div>';
    } else {
      verdict = '<div class="notice"><p><strong>未超出適用上限 ' + fmt(cap, 2) + "%</strong>。" +
        (r.exceeds
          ? "回贈超過貸款額 1%，已把全部回贈計入貸款額計算成數。"
          : "回贈未超過貸款額 1%，按貸款額計算成數。") + "</p></div>";
    }
    $("ltv-verdict").innerHTML = verdict;
  } catch (error) {
    message.textContent = error.message;
    $("ltv-summary").innerHTML = "";
    $("ltv-verdict").innerHTML = "";
  }
}

function loadLtvExample() {
  $("ltv-loan").value = "4000000";
  $("ltv-value").value = "6000000";
  $("ltv-basic").value = "0.9";
  $("ltv-other").value = "0";
  $("ltv-cap").value = "70";
  $("ltv-prism").value = "yes";
  renderLtv();
}

function initOffer() {
  $("of-principal").value = "4000000";
  addPrepayRow();

  $("of-add").addEventListener("click", () => addPrepayRow());
  $("of-example").addEventListener("click", loadOfferExample);
  $("ltv-example").addEventListener("click", loadLtvExample);

  const offerSection = document.querySelector('[data-route="offer"]');
  offerSection.addEventListener("input", event => {
    if (event.target.id.indexOf("ltv-") === 0) {
      renderLtv();
    } else {
      renderOffer();
    }
  });
  $("ltv-prism").addEventListener("change", renderLtv);

  renderOffer();
  loadLtvExample();
}

// =========================================================
// 8. 銀行財務模型
// U＝αPc−R−v−A；NPV＝−T0＋Σ(Qₜ·U−Fₜ)÷(1＋r)ᵗ
// =========================================================

const FIN_DEFAULTS = Object.freeze({
  P: 400,          // 平均本金（萬元）
  alpha: 80,       // 有效節佣比例（%）
  c: 0.45,         // 可避免淨佣金率（%）
  R: 0.20,         // PRISM 加碼（%）
  Rcap: 10000,     // 加碼上限（元）
  v: 1200,         // 每宗處理成本（元）
  A: 300,          // 每宗獲客成本（元）
  Q: [100, 250, 500, 800, 1000],
  F: [80, 85, 90, 95, 100],
  T0: 300,         // 前置投入（萬元）
  rate: 10,        // 折現率（%）
  funnel: [20, 50, 70, 60, 60],
  balance: 350,    // 續留平均餘額（萬元）
  margin: 0.60     // 續留風險調整貢獻（%）
});

const FIN_UNIT_FIELDS = [
  ["P", "平均本金 P（萬元）", 1, 10000, false],
  ["alpha", "有效節佣比例 α（%）", 0, 100, false],
  ["c", "可避免淨佣金率 c（%）", 0, 5, false],
  ["R", "PRISM 加碼（%）", 0, 5, false],
  ["Rcap", "加碼上限（元）", 0, 1000000, false],
  ["v", "每宗處理成本 v（元）", 0, 1000000, false],
  ["A", "每宗獲客成本 A（元）", 0, 1000000, false]
];

const FUNNEL_LABELS = ["近期有需要", "開始申請", "完成資料", "適合標準流程", "取用"];

function unitContribution(m) {
  const P = m.P * 10000;
  const commission = m.alpha / 100 * P * m.c / 100;
  const R = m.Rcap > 0 ? Math.min(P * m.R / 100, m.Rcap) : P * m.R / 100;
  return {
    commission,
    R,
    v: m.v,
    A: m.A,
    U: commission - R - m.v - m.A
  };
}

function annuityFactor(rate, years) {
  let total = 0;
  for (let t = 1; t <= years; t++) {
    total += 1 / Math.pow(1 + rate / 100, t);
  }
  return total;
}

function financeModel(m) {
  const unit = unitContribution(m);
  const d = t => Math.pow(1 + m.rate / 100, t);
  const years = [];
  let cumulative = -m.T0;
  let discounted = -m.T0;
  let npv3 = -m.T0;
  let payback = null;
  let discPayback = null;
  let turnPositive = null;
  let maxGap = Math.min(0, -m.T0);

  for (let t = 1; t <= 5; t++) {
    const q = m.Q[t - 1];
    const avoided = q * unit.commission / 10000;
    const variable = -q * (unit.R + unit.v + unit.A) / 10000;
    const fixed = -m.F[t - 1];
    const net = avoided + variable + fixed;

    cumulative += net;
    discounted += net / d(t);
    if (t <= 3) {
      npv3 += net / d(t);
    }

    if (turnPositive === null && net > 0) {
      turnPositive = t;
    }
    if (payback === null && cumulative >= 0) {
      payback = t;
    }
    if (discPayback === null && discounted >= 0) {
      discPayback = t;
    }
    maxGap = Math.min(maxGap, cumulative);

    years.push({ q, avoided, variable, fixed, net, cumulative });
  }

  // 投資門檻：使五年淨現值為零的每宗貢獻。
  let qDisc = 0;
  let fDisc = 0;
  for (let t = 1; t <= 5; t++) {
    qDisc += m.Q[t - 1] / d(t);
    fDisc += m.F[t - 1] / d(t);
  }

  const breakevenU = qDisc > 0 ? (m.T0 + fDisc) * 10000 / qDisc : null;
  const P = m.P * 10000;
  const costs = unit.R + unit.v + unit.A;
  const alphaMin = breakevenU !== null && P * m.c > 0
    ? (breakevenU + costs) / (P * m.c / 100) * 100
    : null;
  const cMin = breakevenU !== null && P * m.alpha > 0
    ? (breakevenU + costs) / (P * m.alpha / 100) * 100
    : null;

  return {
    unit,
    years,
    npv: discounted,
    npv3,
    payback,
    discPayback,
    turnPositive,
    maxGap,
    breakevenU,
    alphaMin,
    cMin
  };
}

function scenarioList(m) {
  const with_ = changes => Object.assign({}, m, changes);
  const conservative = [100, 200, 300, 400, 500];

  return [
    ["當前輸入的假設", m, true],
    ["淨佣金降至0.40%", with_({ c: 0.40 })],
    ["平均本金降至300萬元", with_({ P: 300 })],
    ["取用量減半", with_({ Q: m.Q.map(q => q / 2) })],
    ["取用量改為100／200／300／400／500宗", with_({ Q: conservative })],
    ["上項保守取用量且前置投入降至180萬元", with_({ Q: conservative, T0: 180 })],
    ["PRISM加碼提高至0.25%", with_({ R: 0.25 })],
    ["佣金0.40%且有效節佣比例60%", with_({ c: 0.40, alpha: 60 })],
    ["PRISM加碼提高至0.23%", with_({ R: 0.23 })],
    ["加碼0.23%且每宗再增加1小時人手（300元）", with_({ R: 0.23, v: m.v + 300 })]
  ];
}

function buildFinanceForm() {
  const numberField = (id, label, min, max, integer) =>
    '<label for="' + id + '">' + esc(label) + '<input id="' + id +
    '" type="number" min="' + min + '" max="' + max + '" step="' +
    (integer ? "1" : "any") + '" inputmode="' + (integer ? "numeric" : "decimal") + '"></label>';

  $("fin-unit").innerHTML = FIN_UNIT_FIELDS.map(f =>
    numberField("fin-" + f[0], f[1], f[2], f[3], f[4])).join("");

  let years = "";
  for (let t = 1; t <= 5; t++) {
    years += numberField("fin-Q" + t, "Y" + t + " 取用宗數", 0, 1000000, false);
  }
  for (let t = 1; t <= 5; t++) {
    years += numberField("fin-F" + t, "Y" + t + " 固定營運（萬）", 0, 100000, false);
  }
  $("fin-years").innerHTML = years;

  $("fin-global").innerHTML =
    numberField("fin-T0", "前置投入 T0（萬元）", 0, 100000, false) +
    numberField("fin-rate", "折現率（%）", 0, 99, false);

  $("fin-funnel").innerHTML = FUNNEL_LABELS.map((label, i) =>
    numberField("fin-funnel" + i, label + "（%）", 0.01, 100, false)).join("");

  $("fin-retain").innerHTML =
    numberField("fin-balance", "續留平均餘額（萬元）", 0, 100000, false) +
    numberField("fin-margin", "風險調整貢獻（%）", 0, 20, false);
}

function setFinance(m) {
  FIN_UNIT_FIELDS.forEach(f => {
    $("fin-" + f[0]).value = String(m[f[0]]);
  });
  for (let t = 1; t <= 5; t++) {
    $("fin-Q" + t).value = String(m.Q[t - 1]);
    $("fin-F" + t).value = String(m.F[t - 1]);
  }
  $("fin-T0").value = String(m.T0);
  $("fin-rate").value = String(m.rate);
  m.funnel.forEach((v, i) => {
    $("fin-funnel" + i).value = String(v);
  });
  $("fin-balance").value = String(m.balance);
  $("fin-margin").value = String(m.margin);
}

function readFinance() {
  const m = { Q: [], F: [], funnel: [] };

  FIN_UNIT_FIELDS.forEach(f => {
    m[f[0]] = readNumber("fin-" + f[0], f[1], f[2], f[3], f[4]);
  });
  for (let t = 1; t <= 5; t++) {
    m.Q.push(readNumber("fin-Q" + t, "Y" + t + " 取用宗數", 0, 1000000, false));
    m.F.push(readNumber("fin-F" + t, "Y" + t + " 固定營運", 0, 100000, false));
  }
  m.T0 = readNumber("fin-T0", "前置投入 T0", 0, 100000, false);
  m.rate = readNumber("fin-rate", "折現率", 0, 99, false);
  FUNNEL_LABELS.forEach((label, i) => {
    m.funnel.push(readNumber("fin-funnel" + i, label, 0.01, 100, false));
  });
  m.balance = readNumber("fin-balance", "續留平均餘額", 0, 100000, false);
  m.margin = readNumber("fin-margin", "風險調整貢獻", 0, 20, false);

  return m;
}

function yearText(t) {
  return t === null ? "五年內未達" : "Y" + t;
}

function renderFinance() {
  const message = $("fin-message");
  message.textContent = "";

  let m;
  try {
    m = readFinance();
  } catch (error) {
    message.textContent = error.message;
    $("fin-result").style.opacity = "0.4";
    return;
  }
  $("fin-result").style.opacity = "";

  const r = financeModel(m);
  const u = r.unit;
  const kpi = (value, label, tone) =>
    '<div class="kpi' + (tone ? " " + tone : "") + '"><b>' + value + "</b><span>" + label + "</span></div>";

  $("fin-kpis").innerHTML =
    kpi(fmt(u.U, 2) + " 元", "每宗淨變動貢獻 U", u.U >= 0 ? "good" : "bad") +
    kpi(signed(r.npv, 2) + " 萬", "五年淨現值（" + fmt(m.rate, 1) + "%）", r.npv >= 0 ? "good" : "bad") +
    kpi(signed(r.npv3, 2) + " 萬", "只計首三個營運年的淨現值", r.npv3 >= 0 ? "good" : "bad") +
    kpi(yearText(r.turnPositive), "年度營運淨額轉正") +
    kpi(yearText(r.payback) + "／" + yearText(r.discPayback), "回本（未折現／折現）") +
    kpi(fmt(-r.maxGap, 1) + " 萬", "按年末計最大累計資金缺口");

  $("fin-unit-rows").innerHTML = [
    ["平均避免佣金", trim(m.P, 2) + "萬 × " + trim(m.c, 4) + "% × " + trim(m.alpha, 2) + "%", u.commission],
    ["基礎加碼", "min（" + trim(m.P, 2) + "萬 × " + trim(m.R, 4) + "%，" + fmt(m.Rcap, 0) + "）", -u.R],
    ["新增處理", "包含未取用及撤回個案分攤", -u.v],
    ["增量獲客", "包含未轉化線索分攤", -u.A],
    ["淨變動貢獻", "未扣固定營運及前置投入", u.U]
  ].map((row, i) =>
    "<tr" + (i === 4 ? ' class="total"' : "") + "><td>" + esc(row[0]) + "</td><td>" +
    esc(row[1]) + "</td><td>" + fmt(row[2], 2) + "</td></tr>").join("");

  const yr = key => r.years.map(y => "<td>" + fmt(y[key], 2) + "</td>").join("");
  $("fin-year-rows").innerHTML =
    "<tr><td>受惠取用 宗</td>" + r.years.map(y => "<td>" + fmt(y.q, 0) + "</td>").join("") + "</tr>" +
    "<tr><td>避免佣金</td>" + yr("avoided") + "</tr>" +
    "<tr><td>變動成本</td>" + yr("variable") + "</tr>" +
    "<tr><td>固定營運</td>" + yr("fixed") + "</tr>" +
    "<tr><td>年度營運淨額</td>" + yr("net") + "</tr>" +
    '<tr class="total"><td>含T0累計淨額</td>' + yr("cumulative") + "</tr>";

  const line = [{ label: "T0", y: -m.T0 }].concat(r.years.map((y, i) => ({
    label: "Y" + (i + 1),
    y: y.cumulative
  })));
  const bars = r.years.map((y, i) => ({ slot: i + 1, y: y.net }));
  $("fin-chart").innerHTML = barLineChart(bars, line, { label: "五年現金流（萬港元）" });

  $("fin-threshold").innerHTML =
    "<div><dt>五年淨現值不低於零所需的每宗淨變動貢獻</dt><dd>" +
    (r.breakevenU === null ? "—" : fmt(r.breakevenU, 2) + " 元") + "</dd></div>" +
    "<div><dt>佣金維持 " + fmt(m.c, 2) + "% 時，有效節佣比例至少</dt><dd>" +
    (r.alphaMin === null ? "—" : fmt(r.alphaMin, 2) + "%") + "</dd></div>" +
    "<div><dt>比例維持 " + fmt(m.alpha, 0) + "% 時，佣金至少</dt><dd>" +
    (r.cMin === null ? "—" : fmt(r.cMin, 5) + "%") + "</dd></div>" +
    "<div><dt>目前每宗貢獻與門檻差距</dt><dd>" +
    (r.breakevenU === null ? "—" : signed(u.U - r.breakevenU, 2) + " 元") + "</dd></div>";

  const scenarios = scenarioList(m).map(s => {
    const result = financeModel(s[1]);
    return { label: s[0], U: result.unit.U, npv: result.npv, current: s[2] };
  });

  $("fin-sens-rows").innerHTML = scenarios.map(s =>
    "<tr" + (s.current ? ' class="total"' : "") + "><td>" + esc(s.label) + "</td><td>" +
    fmt(s.U, 0) + '</td><td class="' + (s.npv < 0 ? "neg" : "pos") + '">' +
    signed(s.npv, 2) + "</td></tr>").join("");

  // 漏斗
  const conversion = m.funnel.reduce((acc, p) => acc * p / 100, 1);
  $("fin-funnel-rows").innerHTML =
    "<tr><td>合計轉化率</td><td colspan=\"5\">" + fmt(conversion * 100, 2) + "%</td></tr>" +
    "<tr><td>取用目標 宗</td>" + m.Q.map(q => "<td>" + fmt(q, 0) + "</td>").join("") + "</tr>" +
    "<tr><td>約需可觸達人數</td>" + m.Q.map(q => {
      const reach = q / conversion;
      const approx = reach >= 1000 ? Math.round(reach / 1000) * 1000 : Math.ceil(reach);
      return "<td>" + fmt(approx, 0) + '<br><span class="muted small">（' + fmt(Math.ceil(reach), 0) + "）</span></td>";
    }).join("") + "</tr>";

  // 附加情境：到期續留
  const factor = annuityFactor(m.rate, 5);
  const perAccount = m.balance * 10000 * m.margin / 100;
  const negatives = scenarios.filter(s => s.npv < 0);

  $("fin-retain-rows").innerHTML =
    '<tr><td colspan="3" class="small muted">年金因子 ' + fmt(factor, 4) +
    "；每帳戶年貢獻約 " + fmt(perAccount, 0) + " 元</td></tr>" +
    (negatives.length
      ? negatives.map(s => {
        const need = perAccount > 0 ? -s.npv * 10000 / factor / perAccount : null;
        return "<tr><td>" + esc(s.label) + "</td><td>" + fmt(-s.npv, 2) + "</td><td>" +
          (need === null ? "—" : "約" + fmt(Math.round(need), 0) + "（" + fmt(need, 1) + "）") +
          "</td></tr>";
      }).join("")
      : '<tr><td colspan="3">目前各情境淨現值均不低於零，毋須以續留抵消。</td></tr>');
}

function initFinance() {
  buildFinanceForm();
  setFinance(FIN_DEFAULTS);
  $("fin-form").addEventListener("input", renderFinance);
  $("fin-form").addEventListener("submit", event => event.preventDefault());
  $("fin-reset").addEventListener("click", () => {
    setFinance(FIN_DEFAULTS);
    renderFinance();
  });
  renderFinance();
}

// =========================================================
// 9. 原型 App（5 步流程，全部為合成資料）
// =========================================================

const APP_OFFER_TERMS = {
  rate: 3.5,
  basic: 0.8,
  fees: 0,
  extra: POLICY.extraRate,
  extraCap: POLICY.extraCap,
  basicPay: 1,
  basicClaw: 24,
  extraPay: POLICY.extraPayMonth,
  extraClaw: POLICY.extraClawbackMonths,
  penalty: 1,
  penaltyMonths: 24
};

const app = {};

function resetApp() {
  app.step = 0;
  app.type = "purchase";
  app.need = {
    property: "private",
    value: 6000000,
    amount: 4000000,
    years: 30,
    horizon: 36,
    referral: "no",
    consent: false
  };
  app.docs = null;
  app.offerIssued = false;
  app.version = 1;
  app.rate = APP_OFFER_TERMS.rate;
  app.versionNote = "";
  app.offerRead = false;
  app.applyConfirmed = false;
  app.progress = 1;
  app.message = "";
  renderApp();
}

function appDocs(type) {
  const docs = [
    {
      id: "id",
      name: "身份證明文件",
      detail: "來源：行內 KYC 記錄；有效至 2031年5月",
      status: "valid"
    },
    {
      id: "payroll",
      name: "出糧記錄（近 6 個月）",
      detail: "來源：本行出糧帳戶；入帳不自動等同合資格收入，由專員核實",
      status: "valid"
    },
    {
      id: "address",
      name: "住址證明",
      detail: "行內記錄日期 2025年2月，已超過有效期",
      status: "expired",
      actions: [["上載新住址證明（模擬）", "已更新"]]
    },
    {
      id: "income",
      name: "職位及月入申報",
      detail: "申報月入 HK$85,000，與出糧記錄平均 HK$82,300 不一致",
      status: "conflict",
      actions: [["以出糧記錄為準", "已確認以出糧記錄為準"], ["補交收入證明（模擬）", "已補交收入證明"]]
    },
    type === "purchase"
      ? {
        id: "contract",
        name: "臨時買賣合約",
        detail: "行內沒有此文件",
        status: "missing",
        actions: [["上載（模擬）", "已上載"]]
      }
      : {
        id: "mortgage",
        name: "現有按揭結欠及還款記錄",
        detail: "他行轉入須提供；行內沒有此文件",
        status: "missing",
        actions: [["上載（模擬）", "已上載"]]
      },
    {
      id: "tax",
      name: "最近一年稅單",
      detail: "行內沒有此文件",
      status: "missing",
      actions: [["上載（模擬）", "已上載"]]
    }
  ];

  return docs;
}

const DOC_STATUS = {
  valid: ["有效・重用", "done"],
  expired: ["過期・需更新", "bad"],
  conflict: ["矛盾・請確認", "bad"],
  missing: ["待補", "sim"],
  resolved: ["已確認", "done"]
};

function appOfferTerms() {
  return Object.assign({}, APP_OFFER_TERMS, { rate: app.rate });
}

function renderAppSteps() {
  const steps = $("app-steps");
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html += '<li class="' + (app.step >= i ? "on" : "") + '"></li>';
  }
  steps.innerHTML = html;
  steps.setAttribute("aria-label", app.step ? "第 " + app.step + " 步，共 5 步" : "入口");
}

function screenHeader(step, title) {
  return '<p class="small muted" style="margin: 0">第 ' + step + " 步／共 5 步</p><h2>" + esc(title) + "</h2>";
}

function renderApp() {
  renderAppSteps();
  const screen = $("app-screen");
  const render = [appEntry, appNeed, appDocsScreen, appOfferScreen, appCostScreen, appCaseScreen][app.step];
  screen.innerHTML = render();
  bindApp(screen);
}

function appEntry() {
  return (
    '<p class="small muted" style="margin-top: 0">你好，陳先生（合成客戶）</p>' +
    '<div class="tile"><b>PRISM 直達按揭</b><br><span class="small muted">本行出糧客戶 ✓ · 出糧帳戶已連續 26 個月（合成資料）</span></div>' +
    '<button class="tile big" type="button" data-act="start" data-type="purchase"><b>申請本行按揭</b><span>新買樓，按揭本金 200萬至500萬元</span></button>' +
    '<button class="tile big" type="button" data-act="start" data-type="refinance"><b>評估轉按成本</b><span>由他行轉入，先看持有期成本再決定</span></button>' +
    '<p class="small muted">取得其他銀行報價屬自選功能；沒有外部報價，你仍可完成本行申請。</p>' +
    '<p class="small muted"><span class="tag sim">模擬</span> 非真實銀行畫面，不會提交任何申請。</p>'
  );
}

function appNeed() {
  const n = app.need;
  return (
    screenHeader(1, "確認需要") +
    '<p class="small muted">交易類型：' + (app.type === "purchase" ? "新按（新買樓）" : "他行轉入") + "</p>" +
    '<div class="fields" style="grid-template-columns: 1fr">' +
    '<label>物業類型<select id="ap-property">' +
    '<option value="private"' + (n.property === "private" ? " selected" : "") + ">香港標準私人住宅</option>" +
    '<option value="subsidised"' + (n.property === "subsidised" ? " selected" : "") + ">資助房屋</option>" +
    "</select></label>" +
    '<label>物業估值（HK$）<input id="ap-value" type="number" inputmode="decimal" value="' + n.value + '"></label>' +
    '<label>融資額（HK$）<input id="ap-amount" type="number" inputmode="decimal" value="' + n.amount + '"></label>' +
    '<label>年期（年）<input id="ap-years" type="number" inputmode="numeric" value="' + n.years + '"></label>' +
    '<label>預計持有期（月）<input id="ap-horizon" type="number" inputmode="numeric" value="' + n.horizon + '"></label>' +
    '<label>是否已有中介就這宗交易向本行提交轉介？<select id="ap-referral">' +
    '<option value="no"' + (n.referral === "no" ? " selected" : "") + ">沒有</option>" +
    '<option value="yes"' + (n.referral === "yes" ? " selected" : "") + ">有</option>" +
    "</select></label>" +
    "</div>" +
    '<label class="check"><input id="ap-consent" type="checkbox"' + (n.consent ? " checked" : "") +
    '><span class="small">我同意本行為「按揭申請及成本核對」這個指定用途，使用我的行內資料。</span></label>' +
    '<p class="message small">' + esc(app.message) + "</p>" +
    '<div class="actions"><button type="button" data-act="back">返回</button>' +
    '<button type="button" class="primary" data-act="need-next">下一步</button></div>'
  );
}

function appDocsScreen() {
  const docs = app.docs;
  const outstanding = docs.filter(d => d.status !== "valid" && d.status !== "resolved").length;

  return (
    screenHeader(2, "整理資料") +
    '<p class="small muted">用途：按揭申請及成本核對（指定用途授權）。已重用行內有效資料，只列出需要你處理的項目。</p>' +
    docs.map(d => {
      const status = DOC_STATUS[d.status];
      return (
        '<div class="tile doc-item"><div class="info"><b>' + esc(d.name) + "</b><small>" +
        esc(d.resolvedNote || d.detail) + "</small>" +
        (d.actions && d.status !== "resolved"
          ? '<div class="ops">' + d.actions.map((a, i) =>
            '<button type="button" data-act="doc" data-doc="' + d.id + '" data-i="' + i + '">' + esc(a[0]) + "</button>").join("") + "</div>"
          : "") +
        '</div><span class="tag ' + status[1] + '">' + status[0] + "</span></div>"
      );
    }).join("") +
    '<p class="small"><strong>' + (outstanding ? "尚餘 " + outstanding + " 項待處理" : "資料已齊備") + "</strong></p>" +
    '<div class="actions"><button type="button" data-act="back">返回</button>' +
    '<button type="button" class="primary" data-act="docs-next"' + (outstanding ? " disabled" : "") +
    ">提交予專員出具方案</button></div>"
  );
}

function appOfferScreen() {
  if (!app.offerIssued) {
    return (
      screenHeader(3, "取得方案") +
      '<div class="notice"><p class="small">資料已提交予按揭專員（模擬）。<br>人工試點目標：1工作日首次聯絡、1工作日初次資料審查，以及資料齊備後1工作日出具條件方案。補件通知不算出價完成。</p></div>' +
      '<div class="actions"><button type="button" data-act="back">返回</button>' +
      '<button type="button" class="primary" data-act="issue">查看條件方案（模擬出具）</button></div>'
    );
  }

  const n = app.need;
  const today = new Date();
  const expiry = new Date(today.getTime() + 14 * 86400000);
  const basic = roundMoney(n.amount * APP_OFFER_TERMS.basic / 100);
  const extra = prismAward(n.amount);
  const ltv = calculateLtv(n.amount, n.value, APP_OFFER_TERMS.basic, 0, true);

  return (
    screenHeader(3, "取得方案") +
    (app.versionNote ? '<div class="notice warn"><p class="small">' + esc(app.versionNote) + "</p></div>" : "") +
    '<div class="tile"><dl class="kv">' +
    "<div><dt>方案編號</dt><dd>PRISM-CO-2026-00128 · v" + app.version + "</dd></div>" +
    "<div><dt>出具者</dt><dd>按揭專員（授權職員，模擬）</dd></div>" +
    "<div><dt>資料日期</dt><dd>" + isoDate(today) + "</dd></div>" +
    "<div><dt>有效期至</dt><dd>" + isoDate(expiry) + "</dd></div>" +
    "<div><dt>本金</dt><dd>" + money(n.amount) + "</dd></div>" +
    "<div><dt>年期</dt><dd>" + n.years + " 年</dd></div>" +
    "<div><dt>年利率</dt><dd>" + fmt(app.rate, 2) + "%（合成示例）</dd></div>" +
    "<div><dt>封頂</dt><dd>示例為固定利率教學模型</dd></div>" +
    "<div><dt>方案費用</dt><dd>HK$0.00</dd></div>" +
    "<div><dt>銀行基本回贈</dt><dd>0.80%（" + money(basic) + "）</dd></div>" +
    "<div><dt>PRISM 擬議加碼</dt><dd>0.20%（" + money(extra) + "）</dd></div>" +
    "<div><dt>回贈支付</dt><dd>基本第 1 月；PRISM 取用後30曆日內</dd></div>" +
    "<div><dt>提前清還</dt><dd>24 個月內全清按未還本金 1%</dd></div>" +
    "<div><dt>回贈追回</dt><dd>24 個月內全清追回已付回贈</dd></div>" +
    "<div><dt>按揭成數</dt><dd>" + fmt(ltv.ltv, 2) + "%" + (ltv.exceeds ? "（回贈計入）" : "") + "</dd></div>" +
    "</dl></div>" +
    '<div class="tile"><b>待完成核驗</b><ul class="small" style="margin: 6px 0 0">' +
    "<li>物業估值</li><li>正式信貸審批</li><li>收入最終核實</li><li>律師文件及簽署</li></ul>" +
    '<p class="small muted" style="margin-bottom: 0">條件方案不等於最終批核。收入、估值、信貸或產品條件變更時，銀行重新審核；系統保留前後版本及你的確認記錄。</p></div>' +
    (app.version === 1
      ? '<button type="button" data-act="revise" style="width: 100%; margin-bottom: 12px">模擬條款改動（估值後利率調整）</button>'
      : "") +
    '<label class="check"><input id="ap-read" type="checkbox"' + (app.offerRead ? " checked" : "") +
    '><span class="small">我已閱讀尚待核驗事項及條款（v' + app.version + "）。</span></label>" +
    '<div class="actions"><button type="button" data-act="back">返回</button>' +
    '<button type="button" class="primary" data-act="offer-next"' + (app.offerRead ? "" : " disabled") +
    ">核對成本</button></div>"
  );
}

function appCostScreen() {
  const n = app.need;
  const months = n.years * 12;
  const terms = appOfferTerms();
  const exits = [12, 24, 25, 36, n.horizon]
    .filter((m, i, list) => m <= months && list.indexOf(m) === i)
    .sort((a, b) => a - b);

  const rows = exits.map(m => {
    const r = evaluateOffer(terms, n.amount, months, m);
    return "<tr" + (m === n.horizon ? ' class="total"' : "") + "><td>第 " + m + " 月</td><td>" +
      fmt(r.cost, 0) + "</td><td>" + fmt(r.balance, 0) + "</td></tr>";
  }).join("");

  const atHorizon = evaluateOffer(terms, n.amount, months, n.horizon);

  return (
    screenHeader(4, "核對成本") +
    '<p class="small">按預計持有期 <strong>' + n.horizon + " 個月</strong>，本方案（v" + app.version +
    "，年利率 " + fmt(app.rate, 2) + "%）淨融資成本約 <strong>" + money(atHorizon.cost) + "</strong>，每月供款 " +
    money(atHorizon.payment) + "。</p>" +
    '<div class="table-wrap"><table class="num"><thead><tr><th>退出</th><th>淨成本</th><th>未還本金</th></tr></thead><tbody>' +
    rows + "</tbody></table></div>" +
    '<p class="small muted">淨融資成本＝利息＋費用＋清還罰款＋回贈追回－已收回贈。退出時仍須清還的本金另列。24 個月內全清須付罰款並退回回贈，所以第 24 與 25 月差距明顯。</p>' +
    '<button type="button" data-act="compare" style="width: 100%; margin-bottom: 8px">與其他報價比較（自選）</button>' +
    '<label class="check"><input id="ap-apply" type="checkbox"' + (app.applyConfirmed ? " checked" : "") +
    '><span class="small">我確認以此方案提交正式申請（模擬，不會真的提交）。</span></label>' +
    '<div class="actions"><button type="button" data-act="back">返回</button>' +
    '<button type="button" class="primary" data-act="apply"' + (app.applyConfirmed ? "" : " disabled") +
    ">提交正式申請</button></div>"
  );
}

const CASE_STAGES = [
  ["提交正式申請", "客戶", "已完成"],
  ["首次聯絡", "按揭專員", "目標 1 工作日"],
  ["初次資料審查", "按揭專員", "目標 1 工作日"],
  ["物業估值", "估值及信貸", "逾時須列原因、責任人和下一期限"],
  ["正式信貸審批", "信貸", "另行計時"],
  ["律師文件及簽署", "客戶及律師", "完成法定確認及簽署"],
  ["取用（貸款正式發放）", "營運", "按實際週期追蹤"],
  ["PRISM 優惠支付", "財務", "取用後 30 曆日內"],
  ["追回期屆滿", "系統", "取用起 24 個月"]
];

function appCaseScreen() {
  const n = app.need;
  const p = app.progress;
  const award = prismAward(n.amount);
  const offerStatus =
    p < 6 ? "預算已預留 · 雙人覆核完成 · 待取用"
      : p === 6 ? "已取用，待支付（30 曆日內）"
        : p === 7 ? "已支付 " + money(award) + " · 追回期中（至第 24 個月）"
          : p === 8 ? "已支付 " + money(award) + " · 追回期中（至第 24 個月）"
            : "追回期已屆滿 · 優惠完成";
  const next = CASE_STAGES[Math.min(p, CASE_STAGES.length - 1)];

  return (
    screenHeader(5, "跟進取用") +
    '<div class="tile"><dl class="kv">' +
    "<div><dt>案件編號</dt><dd>PRISM-CASE-2026-0412</dd></div>" +
    "<div><dt>負責人</dt><dd>按揭專員 李小姐（合成）</dd></div>" +
    "<div><dt>方案</dt><dd>PRISM-CO-2026-00128 · v" + app.version + "</dd></div>" +
    "<div><dt>補件</dt><dd>" + (p === 3 ? "估值報告待出（模擬）" : "暫無") + "</dd></div>" +
    "<div><dt>優惠狀態</dt><dd>" + esc(offerStatus) + "</dd></div>" +
    "</dl></div>" +
    (p < CASE_STAGES.length
      ? '<div class="notice"><p class="small"><strong>下一步：</strong>' + esc(next[0]) + "<br>責任人：" +
        esc(next[1]) + "　期限：" + esc(next[2]) + "</p></div>"
      : '<div class="notice"><p class="small"><strong>案件已完成。</strong>同一案件編號貫穿申請、補件、取用和優惠。</p></div>') +
    '<ol class="timeline">' +
    CASE_STAGES.map((s, i) =>
      '<li class="' + (i < p ? "done" : i === p ? "current" : "") + '">' + esc(s[0]) +
      "<small>" + esc(s[1]) + " · " + esc(s[2]) + "</small></li>").join("") +
    "</ol>" +
    '<div class="actions">' +
    (p < CASE_STAGES.length
      ? '<button type="button" class="primary" data-act="advance">模擬下一步</button>'
      : "") +
    '<button type="button" data-act="restart">重新開始演示</button></div>'
  );
}

function bindApp(screen) {
  const buttons = screen.querySelectorAll("[data-act]");

  for (let i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", () => appAction(buttons[i]));
  }

  const read = $("ap-read");
  if (read) {
    read.addEventListener("change", () => {
      app.offerRead = read.checked;
      renderApp();
    });
  }

  const apply = $("ap-apply");
  if (apply) {
    apply.addEventListener("change", () => {
      app.applyConfirmed = apply.checked;
      renderApp();
    });
  }
}

function saveNeedForm() {
  const n = app.need;
  n.property = $("ap-property").value;
  n.value = $("ap-value").valueAsNumber;
  n.amount = $("ap-amount").valueAsNumber;
  n.years = $("ap-years").valueAsNumber;
  n.horizon = $("ap-horizon").valueAsNumber;
  n.referral = $("ap-referral").value;
  n.consent = $("ap-consent").checked;
}

function validateNeed() {
  const n = app.need;

  if (n.property !== "private") {
    return "資助房屋不在首期範圍，另行評估；已為你轉交一般人工服務（模擬）。";
  }
  if (n.referral === "yes") {
    return "按試點規則，已有有效中介轉介的交易維持原渠道處理，不改標為直接客戶。你仍可經一般服務申請。";
  }
  if (!Number.isFinite(n.value) || n.value <= 0) {
    return "請填寫物業估值。";
  }
  if (!Number.isFinite(n.amount) || n.amount < POLICY.minimumPrincipal || n.amount > POLICY.maximumPrincipal) {
    return "首期只處理 200萬至500萬元的標準按揭；超出範圍由一般人工服務承接。";
  }
  if (n.amount >= n.value) {
    return "融資額須低於物業估值。";
  }
  if (!Number.isInteger(n.years) || n.years < 1 || n.years > 30) {
    return "年期須為 1 至 30 年的整數。";
  }
  if (!Number.isInteger(n.horizon) || n.horizon < 1 || n.horizon > n.years * 12) {
    return "預計持有期須為 1 至 " + (n.years * 12) + " 個月的整數。";
  }
  if (!n.consent) {
    return "請先同意指定用途授權。";
  }
  return "";
}

function appAction(button) {
  const act = button.getAttribute("data-act");
  app.message = "";

  if (act === "start") {
    app.type = button.getAttribute("data-type");
    app.step = 1;
  } else if (act === "back") {
    if (app.step === 1) {
      saveNeedForm();
    }
    app.step = Math.max(0, app.step - 1);
  } else if (act === "need-next") {
    saveNeedForm();
    app.message = validateNeed();
    if (!app.message) {
      if (!app.docs || app.docs.type !== app.type) {
        app.docs = appDocs(app.type);
        app.docs.type = app.type;
      }
      app.step = 2;
    }
  } else if (act === "doc") {
    const doc = app.docs.filter(d => d.id === button.getAttribute("data-doc"))[0];
    const action = doc.actions[Number(button.getAttribute("data-i"))];
    doc.status = "resolved";
    doc.resolvedNote = action[1] + " · " + isoDate(new Date());
  } else if (act === "docs-next") {
    app.step = 3;
  } else if (act === "issue") {
    app.offerIssued = true;
  } else if (act === "revise") {
    app.version = 2;
    app.rate = 3.55;
    app.offerRead = false;
    app.applyConfirmed = false;
    app.versionNote =
      "條款已由 v1 改為 v2：年利率 3.50% → 3.55%（估值後調整，模擬）。舊核驗已失效，成本已重新計算，請重新確認。";
  } else if (act === "offer-next") {
    app.step = 4;
  } else if (act === "compare") {
    prefillCostFromApp();
    location.hash = "#cost";
    return;
  } else if (act === "apply") {
    app.step = 5;
    app.progress = 1;
  } else if (act === "advance") {
    app.progress = Math.min(CASE_STAGES.length, app.progress + 1);
  } else if (act === "restart") {
    resetApp();
    return;
  }

  renderApp();
  if (window.innerWidth < 900) {
    $("app-screen").scrollIntoView({ block: "start" });
  }
}

function prefillCostFromApp() {
  const n = app.need;
  const state = prismVersusBroker({ horizon: n.horizon });
  state.names.A = "PRISM 條件方案 v" + app.version;
  state.inputs.principal = n.amount;
  state.inputs.months = n.years * 12;
  state.inputs.A = appOfferTerms();
  setCostState(state);
  cost.source = "由原型 App 條件方案帶入；中介方案為合成示例，請改為你的外部報價";
  $("cost-source").textContent = cost.source;
  $("cost-confirmed").checked = false;
  invalidateCost();
}

// ---------- 解釋服務（固定核准說明） ----------

const FAQ = [
  {
    q: "甚麼是淨融資成本？",
    a: "淨融資成本＝累計利息＋方案特有費用＋清還罰款＋回贈追回－已收回贈。退出時仍須清還的本金另列，避免把成本較低誤解為所需現金較少。",
    src: "立項書第3章「持有期成本」；附錄「按揭模型」",
    keys: ["淨融資成本", "成本", "計算", "利息", "怎樣計"]
  },
  {
    q: "為甚麼要看預計持有期？",
    a: "同一組條款，在不同退出時間結論可以相反。立項書教學例子中，轉按方案若在24個月內全清，須付1%罰款並退回全部回贈，較貴約6萬元；第25月起罰款及追回不適用，反而較省約2.3萬至2.7萬元。",
    src: "立項書第3章「持有期成本」",
    keys: ["持有期", "持有", "退出", "12", "36", "轉按", "結論"]
  },
  {
    q: "條件方案是否等於批核？",
    a: "不等於。條件方案列明本金、年期、利率及封頂、費用、回贈、提前清還和追回條款，以及出具者、資料日期、有效期及待完成核驗。收入、估值、信貸或產品條件變更時，銀行會重新審核；AI 輸出不作批准。",
    src: "立項書第3章「方案內容」；第6章「授信誤導」",
    keys: ["批核", "批准", "審批", "條件方案", "保證", "一定"]
  },
  {
    q: "PRISM 優惠何時支付？",
    a: "擬議加碼為實際取用本金0.20%，每宗上限10,000元，於符合資格並取用後30曆日內支付；銀行基本回贈另列。全部屬待批准政策。",
    src: "立項書第3章「直達優惠」",
    keys: ["支付", "何時", "幾時", "甚麼時候", "加碼", "0.20", "發放", "入帳"]
  },
  {
    q: "甚麼情況會追回優惠？",
    a: "取用日起至24個月屆滿當日全清或轉按離行，追回未曾追回的已付PRISM餘額，取消未付部分。期內非例行部分還本按原優惠乘以還本額佔原本金比例調整，正常供款不調整。例：400萬元貸款第12月額外還本40萬元，追回800元；第18月全清，再追回7,200元。",
    src: "立項書第3章「直達優惠」；附錄「優惠及日期」",
    keys: ["追回", "被追回", "收回", "退回", "全清", "還本", "離行", "24"]
  },
  {
    q: "為甚麼系統有時停止排名？",
    a: "罰息或回贈追回條款缺失時，系統不把未知當作零，停止完整排名；未支援的浮息重設、部分還本或特殊條款亦停止自動排名，交專員處理。",
    src: "立項書第1章；第4章「故障處理」",
    keys: ["停止", "排名", "未知", "缺", "條款", "不完整"]
  },
  {
    q: "如果其他銀行或中介較便宜？",
    a: "系統按相同持有期口徑照實顯示差距，由你自行選擇；同條款換品牌結果須相同，外行較省亦照實顯示。本案不設按中介報價補差；未確認個人資格的公開優惠只可列為參考。",
    src: "立項書第3章「直達優惠」；第6章「比較偏向本行」",
    keys: ["中介", "其他銀行", "外行", "便宜", "較省", "補差", "比較", "偏向"]
  },
  {
    q: "我的資料會如何使用？",
    a: "比較、貸款申請及推廣用途分開，最少取數、加密及最小權限；不用客戶文件默認訓練模型，並提供人工處理及更正渠道。本演示只用合成資料。",
    src: "立項書第6章「資料及AI風險」「資料與責任」",
    keys: ["資料", "私隱", "隱私", "用途", "訓練", "刪除", "安全"]
  },
  {
    q: "可以轉真人專員嗎？",
    a: "可以。解釋服務可隨時轉人工；模型沒有出價或付款權限。人工試點目標為1工作日首次聯絡。",
    src: "立項書第3章「服務時限」；第4章「系統架構」",
    keys: ["真人", "專員", "人工", "聯絡", "客服"]
  },
  {
    q: "回贈會否影響按揭成數？",
    a: "回贈超過貸款額1%時，須把該筆回贈計入貸款額計算按揭成數，而非只計超出部分。例：貸款400萬元、估值600萬元、回贈合計44,000元，成數為67.40%。接近適用上限時，會重新核對本金與首期並取得你的確認，不靜默減少放款。",
    src: "立項書第6章「回贈處理」",
    keys: ["成數", "1%", "估值", "現金回贈", "上限"]
  }
];

function showFaq(item) {
  const box = $("faq-answer");

  if (!item) {
    box.innerHTML =
      '<div class="faq-answer"><strong>未有核准說明涵蓋此問題。</strong><br>' +
      "按「無來源不補寫」原則，本服務不會自行編寫答案；已為你轉交按揭專員跟進（模擬）。" +
      '<span class="src">來源：立項書第4章「解釋服務」控制</span></div>';
    return;
  }

  box.innerHTML =
    '<div class="faq-answer"><strong>' + esc(item.q) + "</strong><br>" + esc(item.a) +
    '<span class="src">來源：' + esc(item.src) + "</span></div>";
}

function askFaq() {
  const query = $("faq-query").value.trim().toLowerCase();

  if (!query) {
    return;
  }

  let best = null;
  let bestScore = 0;

  FAQ.forEach(item => {
    let score = 0;
    item.keys.forEach(key => {
      if (query.indexOf(key.toLowerCase()) >= 0) {
        score += key.length;
      }
    });
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  });

  showFaq(best);
}

function initApp() {
  const list = $("faq-list");
  FAQ.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.q;
    button.addEventListener("click", () => showFaq(item));
    list.appendChild(button);
  });

  $("faq-ask").addEventListener("click", askFaq);
  $("faq-query").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      askFaq();
    }
  });

  resetApp();
}

// =========================================================
// 10. 首頁案例捷徑
// =========================================================

const DEMOS = {
  "app-start": () => resetApp(),
  "cost-teaching": () => {
    loadCostPreset("teaching");
    $("cost-confirmed").checked = true;
    calculateCostNow();
  },
  "cost-missing": () => {
    loadCostPreset("missing");
    $("cost-confirmed").checked = true;
    calculateCostNow();
  },
  "offer-example": () => loadOfferExample(),
  "ltv-example": () => loadLtvExample()
};

(function () {
  const links = document.querySelectorAll("[data-demo]");
  for (let i = 0; i < links.length; i++) {
    links[i].addEventListener("click", () => {
      const demo = DEMOS[links[i].getAttribute("data-demo")];
      if (demo) {
        demo();
      }
    });
  }
})();

// =========================================================
// 11. 啟動
// =========================================================

initCost();
initOffer();
initFinance();
initApp();
showRoute();
