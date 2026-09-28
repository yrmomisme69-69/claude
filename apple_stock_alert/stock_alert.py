#!/usr/bin/env python3
"""
Apple 香港「有貨提醒」：定時查詢指定型號的門市取貨／送貨狀態，有貨時用 Mac 提示音及 Gmail 通知你。

只查詢、不購買、不登入。每次只發一個細小的查詢，頻率溫和（預設 3–5 分鐘，下限 60 秒）。
如果 Apple 拒絕查詢，工具會放慢並通知你，不會嘗試偽裝或繞過。
"""

import argparse
import json
import random
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

import yaml

from notifier import Notifier

try:  # python.org 版 Python 在 macOS 預設沒有根證書，有 certifi 就用它
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

MIN_INTERVAL = 60.0
PART_RE = r"[A-Z0-9]{4,6}Z[AP]/A"  # 香港版型號編號以 ZA/A 或 ZP/A 結尾
USER_AGENT = "apple-hk-stock-alert/1.0 (personal restock notifier)"
BLOCKED_CODES = {403, 429, 503, 541}


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


class Blocked(Exception):
    pass


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


# ---------- 查詢及解析 ----------

def build_url(cfg):
    base = cfg.get("base_url") or f"https://www.apple.com/{cfg.get('country', 'hk')}"
    params = {"pl": "true", "mts.0": "regular", "mts.1": "compact", "searchNearby": "true",
              "location": cfg.get("location", "香港")}
    for i, p in enumerate(cfg["parts"]):
        params[f"parts.{i}"] = p["part"]
    return f"{base.rstrip('/')}/shop/fulfillment-messages?{urllib.parse.urlencode(params)}"


def parse(data, parts, store_keywords):
    """回傳 {(part, 地點): (有貨?, 說明)}。地點 = 門市名稱，或 "送貨"。"""
    content = (data.get("body") or {}).get("content") or {}
    result = {}
    keywords = [k.lower() for k in store_keywords or []]

    for store in (content.get("pickupMessage") or {}).get("stores") or []:
        name = store.get("storeName") or store.get("storeNumber") or "?"
        if keywords and not any(k in name.lower() for k in keywords):
            continue
        for part in parts:
            info = (store.get("partsAvailability") or {}).get(part)
            if not info:
                continue
            available = info.get("pickupDisplay") == "available"
            quote = info.get("pickupSearchQuote") or info.get("pickupDisplay") or ""
            result[(part, f"門市：{name}")] = (available, re.sub(r"<[^>]+>", "", quote))

    for part in parts:
        msg = ((content.get("deliveryMessage") or {}).get(part) or {}).get("regular") or {}
        if not msg:
            continue
        buyable = bool((msg.get("buyability") or {}).get("isBuyable"))
        options = msg.get("deliveryOptionMessages") or []
        quote = "；".join(o.get("displayName", "") for o in options if isinstance(o, dict)) or msg.get("stockStatus", "")
        result[(part, "送貨")] = (buyable, quote)
    return result


def check_once(cfg, debug=False):
    status, text = fetch(build_url(cfg))
    if debug:
        out = Path(__file__).resolve().parent / "last_response.json"
        out.write_text(text, encoding="utf-8")
        log(f"已把 Apple 原始回覆存到 {out}（HTTP {status}）")
    if status in BLOCKED_CODES:
        raise Blocked(f"HTTP {status}")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise Blocked(f"HTTP {status}，回覆不是 JSON（可能被擋或網址已改）")
    parts = [p["part"] for p in cfg["parts"]]
    stores = cfg.get("stores") or []
    result = parse(data, parts, stores)
    if not cfg.get("check_delivery", True):
        result = {k: v for k, v in result.items() if k[1] != "送貨"}
    return result


def find_parts(url):
    """從購買頁原始碼找出香港型號編號（…ZA/A 或 …ZP/A）及附近的名稱、顏色、容量等描述。"""
    status, html = fetch(url)
    if status != 200:
        sys.exit(f"載入購買頁失敗（HTTP {status}）。請改用 Safari：開發 → 顯示網頁原始碼，搜尋「ZA/A」。")
    found = {}
    for m in re.finditer(r'"partNumber"\s*:\s*"(' + PART_RE + ')"', html):
        # 只看包住這個編號的那一個 {...}，以免讀到隔壁型號的資料
        start = html.rfind("{", 0, m.start())
        end = html.find("}", m.end())
        window = html[start: end + 1] if start >= 0 and end >= 0 else ""
        dims = dict(re.findall(r'"dimension(\w+)"\s*:\s*"([^"]+)"', window))
        name = re.search(r'"(?:productTitle|productName|displayName|title|name)"\s*:\s*"([^"]+)"', window)
        if name:
            dims["name"] = name.group(1)
        found.setdefault(m.group(1), dims)
    for m in re.finditer(r"\b(" + PART_RE + r")\b", html):
        found.setdefault(m.group(1), {})
    if not found:
        sys.exit("頁面中找不到型號編號。請改用 Safari：開發 → 顯示網頁原始碼，搜尋「ZA/A」。")
    print(f"找到 {len(found)} 個型號編號：")
    for part, dims in found.items():
        desc = "  ".join(f"{k}={v}" for k, v in dims.items() if k.lower() in ("name", "color", "capacity", "screensize"))
        print(f"  {part}  {desc}")


# ---------- 主循環 ----------

class Alerter:
    def __init__(self, cfg, notifier):
        self.cfg = cfg
        self.n = notifier
        self.names = {p["part"]: p.get("name") or p["part"] for p in cfg.get("parts") or []}
        self.last = {}
        self.buy_url = cfg.get("buy_url") or f"https://www.apple.com/{cfg.get('country', 'hk')}/shop/buy-iphone"
        lr = cfg.get("launch_reminder") or {}
        self.launch = datetime.fromisoformat(str(lr["time"])) if lr.get("time") else None
        self.reminders = sorted((float(m) for m in lr.get("minutes_before", [15, 2])), reverse=True)
        self.reminded = set()

    def interval(self):
        lo, hi = self.cfg.get("interval_seconds", [180, 300])
        return max(MIN_INTERVAL, random.uniform(float(lo), float(hi)))

    def launch_reminders(self):
        if not self.launch:
            return
        now = datetime.now(self.launch.tzinfo)
        for m in self.reminders:
            if m not in self.reminded and now >= self.launch - timedelta(minutes=m) and now < self.launch + timedelta(minutes=5):
                self.reminded.add(m)
                self.n.notify(f"⏰ 還有約 {m:.0f} 分鐘開賣",
                              f"開賣時間：{self.launch:%Y-%m-%d %H:%M}\n請準備好 Apple Store App 或 Safari。\n購買頁：{self.buy_url}",
                              urgent=m <= 5)

    def report(self, result):
        newly = []
        for key, (available, quote) in sorted(result.items()):
            part, where = key
            mark = "✅ 有貨" if available else "❌ 冇貨"
            log(f"   {mark}  {self.names[part]}  {where}  {quote}")
            if available and not self.last.get(key):
                newly.append(f"• {self.names[part]}（{part}）— {where}\n  {quote}")
            self.last[key] = available
        if not result:
            log("   （回覆中找不到你指定的型號／門市，請用 --once --debug 檢查）")
        if newly:
            self.n.notify("📱 有貨！請立即親手購買", "\n".join(newly) + f"\n\n購買頁：{self.buy_url}", urgent=True)

    def run_reminders_only(self):
        """只做開賣提醒，完全不連 Apple。"""
        if not self.launch:
            sys.exit("只提醒模式需要在 config.yaml 的 launch_reminder.time 填上開賣時間。")
        mins = "、".join(f"{m:g}" for m in self.reminders)
        log(f"只提醒模式：不會連 Apple，會在 {self.launch:%m-%d %H:%M} 開賣前 {mins} 分鐘通知你。")
        while len(self.reminded) < len(self.reminders) and datetime.now(self.launch.tzinfo) < self.launch + timedelta(minutes=5):
            self.launch_reminders()
            time.sleep(20)
        log("提醒已全部發出（或已過開賣時間），結束。")

    def run(self, once=False, debug=False):
        backoff, blocked_streak, told_blocked = 0.0, 0, False
        while True:
            self.launch_reminders()
            try:
                log("查詢中……")
                self.report(check_once(self.cfg, debug))
                backoff, blocked_streak, told_blocked = 0.0, 0, False
            except Blocked as e:
                blocked_streak += 1
                backoff = min(max(backoff * 2, 300.0), 1800.0)
                log(f"⚠️ Apple 拒絕查詢（{e}），{backoff / 60:.0f} 分鐘後再試")
                if blocked_streak >= 3 and not told_blocked:
                    told_blocked = True
                    self.n.notify("⚠️ Apple 連續拒絕查詢",
                                  f"原因：{e}\n工具已放慢到每 {backoff / 60:.0f} 分鐘一次。"
                                  "如果持續，請改用 Apple Store App 手動查看。")
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                log(f"網絡錯誤：{e}")
            if once:
                return
            time.sleep(backoff or self.interval())


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="Apple 香港有貨提醒")
    ap.add_argument("-c", "--config", default=str(here / "config.yaml"))
    ap.add_argument("--once", action="store_true", help="只查一次就結束（測試用）")
    ap.add_argument("--debug", action="store_true", help="把 Apple 原始回覆存到 last_response.json")
    ap.add_argument("--test-email", action="store_true", help="只寄一封測試 email")
    ap.add_argument("--find-parts", metavar="URL", help="從購買頁網址找出型號編號")
    ap.add_argument("--reminder-only", action="store_true", help="只做開賣提醒，不查詢 Apple")
    args = ap.parse_args()

    if args.find_parts:
        find_parts(args.find_parts)
        return

    path = Path(args.config)
    if not path.exists():
        sys.exit(f"找不到設定檔 {path}。請先：cp config.example.yaml config.yaml 再修改。")
    cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    notifier = Notifier(cfg)
    if args.test_email:
        notifier.notify("測試通知", "收到這封 email 代表通知設定正確。", wait=True)
        return
    reminder_only = args.reminder_only or cfg.get("check_stock") is False
    if not reminder_only and not cfg.get("parts"):
        sys.exit("config.yaml 未填 parts（型號編號）。")
    try:
        alerter = Alerter(cfg, notifier)
        if reminder_only:
            alerter.run_reminders_only()
        else:
            alerter.run(once=args.once, debug=args.debug)
    except KeyboardInterrupt:
        log("已停止。")


if __name__ == "__main__":
    main()
