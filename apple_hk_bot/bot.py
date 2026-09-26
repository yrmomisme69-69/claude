#!/usr/bin/env python3
"""
Apple 香港網上商店「半自動」購買腳本。

流程：等到開賣時間 → 以溫和、隨機的頻率刷新商品頁 → 點選型號／顏色／容量
→ 加入購物袋 → 結帳 → 自動填寫送貨資料 → 停在付款頁，用 email 通知你親手付款。

設計原則（減少被封鎖）：
  * 接上你自己的 Chrome（已登入 Apple ID），不開全新的自動化瀏覽器
  * 刷新間隔隨機、有下限（最少 5 秒），被限流時自動退避
  * 遇到驗證碼／登入／卡住時暫停並通知你，由你親手處理
  * 永遠不會按「下訂單／付款」按鈕
"""

import argparse
import hashlib
import random
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import yaml
from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select

from notifier import Notifier

MIN_INTERVAL = 5.0  # 刷新間隔硬性下限（秒），設定檔再細都不會低於此值

# 安全網：任何文字包含以下字眼的按鈕，腳本都不會按
NEVER_CLICK = ["下訂單", "確認付款", "立即付款", "付款並", "place order", "place your order", "pay now", "submit order"]

ADD_TO_BAG_CSS = ['[data-autom="add-to-cart"]', 'button[name="add-to-cart"]']
ADD_TO_BAG_TEXTS = ["加入購物袋", "加入購物車", "add to bag"]

CONTINUE_CSS = [
    '[data-autom="checkout"]',
    '[data-autom="bag-checkout-button"]',
    '#shoppingCart\\.actions\\.navCheckout',
    '#rs-checkout-continue-button-bottom',
    '[data-autom*="continue"]',
]
CONTINUE_TEXTS = ["結帳", "前往付款", "繼續付款", "繼續", "check out", "checkout", "continue"]
CONTINUE_EXCLUDE = ["購物", "shopping", "訪客", "guest", "apple pay", "返回", "back"]

DELIVERY_TEXTS = ["我想要送貨", "送貨", "i'd like it delivered", "delivered", "delivery"]

PAYMENT_URL_MARKS = ["_s=billing", "_s=payment", "_s=review", "/payment"]
PAYMENT_CSS = ['input[autocomplete="cc-number"]', 'input[name*="cardNumber" i]']
PAYMENT_TEXT_MARKS = ["你想如何付款", "如何付款", "how do you want to pay"]

SIGNIN_URL_MARKS = ["signin", "sign_in", "_s=signin"]
CAPTCHA_IFRAME_MARKS = ["captcha", "arkoselabs", "funcaptcha", "challenges.cloudflare"]
CAPTCHA_TEXT_MARKS = ["驗證碼", "我不是機器人", "captcha", "verify you are human", "i'm not a robot", "type the characters"]
BLOCKED_TEXT_MARKS = ["access denied", "too many requests", "請求過多", "403 forbidden", "你已被封鎖"]
BAG_EMPTY_MARKS = ["你的購物袋是空的", "購物袋是空的", "your bag is empty"]

# 設定檔 contact 欄位 → 網頁輸入框 name/id/autocomplete 的關鍵字（include, exclude）
FIELD_RULES = {
    "last_name": (["lastname", "family-name", "familyname"], []),
    "first_name": (["firstname", "given-name", "givenname"], []),
    "email": (["emailaddress", "email"], ["confirm"]),
    "phone": (["mobilephone", "daytimephone", "phone", "tel"], ["areacode", "extension"]),
    "address_line2": (["street2", "address-line2", "addressline2", "address2"], []),
    "address_line1": (["street", "address-line1", "addressline1", "address1"], ["street2", "line2", "address2"]),
    "district": (["district"], []),
    "region": (["region", "state", "province"], []),
}

JS_RADIOS = """
const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
return [...document.querySelectorAll('input[type=radio]')].map(inp => {
  let label = inp.id ? document.querySelector('label[for="' + CSS.escape(inp.id) + '"]') : null;
  if (!label) label = inp.closest('label');
  return {el: label || inp, input: inp, text: norm(label ? label.textContent : ''),
          value: norm(inp.value), disabled: inp.disabled, checked: inp.checked};
});
"""

JS_BUTTONS = """
const norm = s => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
return [...document.querySelectorAll('button, a, input[type=submit], [role=button]')]
  .filter(el => el.getClientRects().length > 0 && !el.disabled && el.getAttribute('aria-disabled') !== 'true')
  .map(el => ({el, text: norm(el.innerText || el.value || el.getAttribute('aria-label'))}));
"""


def norm(s):
    return " ".join((s or "").split()).lower()


def pause(a=0.4, b=1.2):
    time.sleep(random.uniform(a, b))


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


class Bot:
    def __init__(self, driver, cfg, notifier, stop_after="checkout"):
        self.d = driver
        self.cfg = cfg
        self.n = notifier
        self.stop_after = stop_after
        base = cfg.get("store_base", "https://www.apple.com/hk").rstrip("/")
        self.bag_url = cfg.get("bag_url") or f"{base}/shop/bag"
        self.poll = cfg.get("poll") or {}
        lt = cfg.get("launch_time")
        self.launch = datetime.fromisoformat(str(lt)) if lt else None

    # ---------- 頁面狀態 ----------

    def body_text(self):
        try:
            return norm(self.d.find_element(By.TAG_NAME, "body").text)
        except WebDriverException:
            return ""

    def settle(self, extra=(1.0, 2.0)):
        end = time.time() + 20
        while time.time() < end:
            try:
                if self.d.execute_script("return document.readyState") == "complete":
                    break
            except WebDriverException:
                pass
            time.sleep(0.3)
        pause(*extra)

    def has_captcha(self):
        for f in self.d.find_elements(By.TAG_NAME, "iframe"):
            src = (f.get_attribute("src") or "").lower()
            if any(m in src for m in CAPTCHA_IFRAME_MARKS) and f.is_displayed():
                return True
        text = self.body_text()
        return any(m in text for m in CAPTCHA_TEXT_MARKS)

    def is_blocked(self):
        text = norm(self.d.title) + " " + self.body_text()[:3000]
        return any(m in text for m in BLOCKED_TEXT_MARKS)

    def is_signin(self):
        url = self.d.current_url.lower()
        if any(m in url for m in SIGNIN_URL_MARKS):
            return True
        for f in self.d.find_elements(By.TAG_NAME, "iframe"):
            if "idmsa.apple.com" in (f.get_attribute("src") or "") and f.is_displayed():
                return True
        return any(e.is_displayed() for e in self.d.find_elements(By.CSS_SELECTOR, 'input[type="password"]'))

    def is_payment(self):
        url = self.d.current_url.lower()
        if any(m in url for m in PAYMENT_URL_MARKS):
            return True
        if any(e.is_displayed() for css in PAYMENT_CSS for e in self.d.find_elements(By.CSS_SELECTOR, css)):
            return True
        if any(any(k in b["text"] for k in NEVER_CLICK) for b in self.buttons()):
            return True
        text = self.body_text()
        return any(m in text for m in PAYMENT_TEXT_MARKS)

    def signature(self):
        return self.d.current_url + hashlib.md5(self.body_text()[:4000].encode()).hexdigest()

    def wait_for_change(self, old_sig, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            time.sleep(0.5)
            try:
                if self.signature() != old_sig:
                    self.settle((0.5, 1.0))
                    return True
            except WebDriverException:
                pass
        return False

    def wait_for_human(self, subject, body, done, timeout=15 * 60):
        """通知你，然後等你處理好（done() 回傳 True）才繼續。"""
        self.n.notify(subject, f"{body}\n\n目前網址：{self.d.current_url}", urgent=True)
        end = time.time() + timeout
        while time.time() < end:
            time.sleep(2)
            try:
                if done():
                    log("✅ 偵測到你已處理好，腳本繼續。")
                    self.settle((0.5, 1.0))
                    return True
            except WebDriverException:
                pass
        log("等候超時。")
        return False

    # ---------- 元素操作 ----------

    def buttons(self):
        try:
            return self.d.execute_script(JS_BUTTONS)
        except WebDriverException:
            return []

    def click(self, el, label=""):
        text = norm(el.text or el.get_attribute("value") or el.get_attribute("aria-label"))
        if any(k in text for k in NEVER_CLICK):
            log(f"🛑 安全網：拒絕按「{text}」")
            return False
        self.d.execute_script("arguments[0].scrollIntoView({block: 'center'});", el)
        pause(0.3, 0.8)
        try:
            el.click()
        except WebDriverException:
            self.d.execute_script("arguments[0].click();", el)
        log(f"🖱  按下：{label or text}")
        return True

    def find_button(self, css_list, texts, exclude=()):
        for css in css_list:
            for el in self.d.find_elements(By.CSS_SELECTOR, css):
                try:
                    if el.is_displayed() and el.is_enabled() and el.get_attribute("aria-disabled") != "true":
                        return el
                except WebDriverException:
                    continue
        candidates = [b for b in self.buttons() if b["text"] and not any(x in b["text"] for x in exclude)]
        for t in texts:
            for b in candidates:
                if t in b["text"]:
                    return b["el"]
        return None

    def find_option(self, text, radios=None):
        """找文字符合的選項；有多個時揀文字最短的（例如 "iPhone 18 Pro" 不會揀中 "Pro Max"）。"""
        target = norm(text)
        radios = radios if radios is not None else self.d.execute_script(JS_RADIOS)
        matches = [r for r in radios if target in r["text"] or target == r["value"]]
        return min(matches, key=lambda r: len(r["text"])) if matches else None

    def list_options(self):
        texts = []
        for r in self.d.execute_script(JS_RADIOS):
            t = r["text"][:60]
            if t and t not in texts:
                texts.append(t)
        return texts

    def type_like_human(self, el, value):
        el.clear()
        for ch in str(value):
            el.send_keys(ch)
            time.sleep(random.uniform(0.03, 0.12))

    # ---------- 等開賣 ----------

    def wait_for_launch(self):
        if not self.launch:
            log("未設定開賣時間，立即開始。")
            return
        warmup = timedelta(minutes=float(self.poll.get("warmup_minutes", 3)))
        start = self.launch - warmup
        announced = False
        while True:
            now = datetime.now(self.launch.tzinfo)
            remaining = (start - now).total_seconds()
            if remaining <= 0:
                break
            if not announced:
                log(f"等候中：{start:%m-%d %H:%M:%S} 開始監察（開賣 {self.launch:%H:%M:%S}）。期間不會發出任何請求。")
                announced = True
            if remaining > 60:
                log(f"還有 {remaining / 60:.0f} 分鐘開始……")
            time.sleep(min(60, remaining))
        self.n.notify("準備開始監察", f"開賣時間 {self.launch:%Y-%m-%d %H:%M}，腳本開始刷新商品頁。請留在電腦旁。")

    def next_interval(self):
        lo, hi = self.poll.get("interval_seconds", [30, 60])
        if self.launch:
            now = datetime.now(self.launch.tzinfo)
            fast_end = self.launch + timedelta(minutes=float(self.poll.get("launch_fast_minutes", 10)))
            if self.launch - timedelta(minutes=1) <= now <= fast_end:
                lo, hi = self.poll.get("launch_interval_seconds", [8, 15])
        return max(MIN_INTERVAL, random.uniform(float(lo), float(hi)))

    # ---------- 加入購物袋 ----------

    def product_ready(self):
        if self.find_button(ADD_TO_BAG_CSS, ADD_TO_BAG_TEXTS):
            return True
        opts = self.cfg.get("options") or []
        return bool(opts) and self.find_option(opts[0]) is not None

    def in_bag_or_checkout(self):
        url = self.d.current_url.lower()
        return "/shop/bag" in url or "checkout" in url

    def select_and_add(self):
        for opt in self.cfg.get("options") or []:
            found = None
            end = time.time() + 10
            while time.time() < end:
                r = self.find_option(opt)
                if r and not r["disabled"]:
                    found = r
                    break
                time.sleep(0.5)
            if not found:
                available = "\n".join(f"  - {t}" for t in self.list_options()) or "  （找不到任何選項）"
                log(f"找不到選項「{opt}」。頁面上的選項有：\n{available}")
                return f"找不到選項「{opt}」。\n頁面上的選項有：\n{available}"
            if not found["checked"]:
                self.click(found["el"], f"選項：{opt}")
                pause(0.6, 1.5)

        btn = None
        end = time.time() + 10
        while time.time() < end and not btn:
            btn = self.find_button(ADD_TO_BAG_CSS, ADD_TO_BAG_TEXTS)
            if not btn:
                time.sleep(0.5)
        if not btn:
            return "已選好選項，但「加入購物袋」按鈕未能按（可能缺少某個選項或已售罄）。"
        sig = self.signature()
        self.click(btn, "加入購物袋")
        self.wait_for_change(sig, 20)
        return None

    def bag_has_items(self):
        self.d.get(self.bag_url)
        self.settle()
        text = self.body_text()
        return not any(m in text for m in BAG_EMPTY_MARKS)

    def add_to_bag_loop(self):
        url = self.cfg["product_url"]
        backoff = 0.0
        need_load = True
        tries = 0
        while True:
            if need_load:
                tries += 1
                log(f"第 {tries} 次載入商品頁")
                self.d.get(url)
                self.settle()
            need_load = True

            if self.has_captcha():
                self.wait_for_human("⚠️ 出現驗證碼，請親手完成", "腳本已暫停，完成驗證後會自動繼續。",
                                    lambda: not self.has_captcha())
                need_load = False
                continue

            if self.is_blocked():
                backoff = min(max(backoff * 2, 60.0), float(self.poll.get("max_backoff_seconds", 600)))
                self.n.notify("⚠️ 疑似被限流，放慢速度", f"暫停 {backoff:.0f} 秒後再試。")
                time.sleep(backoff)
                continue
            backoff = 0.0

            if self.product_ready():
                problem = self.select_and_add()
                if problem is None and self.bag_has_items():
                    self.n.notify("🛍 已加入購物袋", "正在進入結帳流程……")
                    return True
                problem = problem or "按了「加入購物袋」但購物袋仍是空的。"
                ok = self.wait_for_human(
                    "⚠️ 自動選購未成功，請親手操作",
                    f"{problem}\n\n請你親手選好並按「加入購物袋」，然後進入購物袋頁面，腳本會接手結帳。",
                    self.in_bag_or_checkout)
                if ok:
                    return True
                continue

            wait = self.next_interval()
            log(f"商品未開賣／未就緒，{wait:.0f} 秒後再試")
            time.sleep(wait)

    # ---------- 結帳 ----------

    def choose_delivery(self):
        radios = self.d.execute_script(JS_RADIOS)
        for t in DELIVERY_TEXTS:
            r = self.find_option(t, radios)
            if r:
                if not r["checked"] and not r["disabled"]:
                    self.click(r["el"], "送貨方式：送貨")
                    pause()
                return

    def fill_contact(self):
        contact = self.cfg.get("contact") or {}
        filled = set()
        for el in self.d.find_elements(By.CSS_SELECTOR, "input, select, textarea"):
            try:
                if not el.is_displayed() or not el.is_enabled():
                    continue
                itype = (el.get_attribute("type") or "").lower()
                if itype in ("hidden", "radio", "checkbox", "password", "submit", "button", "search"):
                    continue
                key = norm(" ".join(el.get_attribute(a) or "" for a in ("name", "id", "autocomplete")))
                field = next((f for f, (inc, exc) in FIELD_RULES.items()
                              if f not in filled and any(k in key for k in inc) and not any(k in key for k in exc)), None)
                value = contact.get(field) if field else None
                if not value:
                    continue
                if el.tag_name == "select":
                    sel = Select(el)
                    if norm(str(value)) in norm(sel.first_selected_option.text):
                        filled.add(field)
                        continue
                    for o in sel.options:
                        if norm(str(value)) in norm(o.text):
                            sel.select_by_visible_text(o.text)
                            log(f"✏️  選擇 {field}：{o.text}")
                            break
                elif not (el.get_attribute("value") or "").strip():
                    self.type_like_human(el, value)
                    log(f"✏️  填寫 {field}")
                    pause(0.2, 0.6)
                filled.add(field)
            except WebDriverException:
                continue

    def checkout(self):
        if not self.in_bag_or_checkout():
            self.d.get(self.bag_url)
            self.settle()
        fulfillment = (self.cfg.get("fulfillment") or "delivery").lower()
        last_sig, stuck = None, 0
        end = time.time() + 20 * 60
        while time.time() < end:
            if self.has_captcha():
                self.wait_for_human("⚠️ 出現驗證碼，請親手完成", "完成後腳本會自動繼續結帳。",
                                    lambda: not self.has_captcha())
                continue
            if self.is_signin():
                self.wait_for_human("🔑 需要登入 Apple ID", "請在 Chrome 視窗親手登入，完成後腳本會自動繼續。",
                                    lambda: not self.is_signin())
                continue
            if self.is_payment():
                self.n.notify(
                    "💳 已到付款頁，請立即親手付款！",
                    "腳本已停下，不會按「下訂單」。\n請到 Chrome 視窗選擇付款方式、輸入資料並確認訂單。\n"
                    f"網址：{self.d.current_url}", urgent=True, wait=True)
                return True

            sig = self.signature()
            stuck = stuck + 1 if sig == last_sig else 0
            last_sig = sig
            if stuck >= 3:
                self.wait_for_human("⚠️ 結帳卡住了，請親手處理這一步",
                                    "可能有欄位未填或需要選擇。你按下一步之後，腳本會繼續。",
                                    lambda: self.signature() != sig)
                last_sig, stuck = None, 0
                continue

            if "fulfillment" in self.d.current_url.lower() and fulfillment == "pickup":
                self.wait_for_human("🏬 請親手選擇取貨分店與時間", "選好並按繼續後，腳本會接手。",
                                    lambda: self.signature() != sig)
                continue
            if fulfillment == "delivery":
                self.choose_delivery()
            self.fill_contact()

            btn = self.find_button(CONTINUE_CSS, CONTINUE_TEXTS, CONTINUE_EXCLUDE)
            if btn and self.click(btn):
                self.wait_for_change(sig, 15)
            else:
                time.sleep(2)
        self.n.notify("⚠️ 結帳流程超時", "請到 Chrome 視窗檢查。", urgent=True, wait=True)
        return False

    def run(self):
        self.wait_for_launch()
        self.add_to_bag_loop()
        if self.stop_after == "bag":
            self.n.notify("🛍 測試完成：已加入購物袋", "按 --stop-after bag 設定停在這裏。", wait=True)
            return
        self.checkout()


def connect(port):
    opts = webdriver.ChromeOptions()
    opts.debugger_address = f"127.0.0.1:{port}"
    try:
        return webdriver.Chrome(options=opts)
    except WebDriverException as e:
        sys.exit(f"連接不到 Chrome（port {port}）。請先執行 ./start_chrome.sh 。\n詳情：{e.msg}")


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="Apple 香港網上商店半自動購買腳本")
    ap.add_argument("-c", "--config", default=str(here / "config.yaml"), help="設定檔路徑")
    ap.add_argument("--stop-after", choices=["bag", "checkout"], default="checkout",
                    help="bag = 加入購物袋後停止（測試用）；checkout = 一直做到付款頁前（預設）")
    ap.add_argument("--test-email", action="store_true", help="只寄一封測試 email，檢查設定")
    args = ap.parse_args()

    path = Path(args.config)
    if not path.exists():
        sys.exit(f"找不到設定檔 {path}。請先：cp config.example.yaml config.yaml 再修改。")
    cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    notifier = Notifier(cfg)

    if args.test_email:
        notifier.notify("測試通知", "收到這封 email 代表通知設定正確。", wait=True)
        return

    driver = connect(int(cfg.get("chrome_debug_port", 9222)))
    try:
        Bot(driver, cfg, notifier, args.stop_after).run()
    except KeyboardInterrupt:
        log("已手動停止。")
    # 不呼叫 driver.quit()，保留你的 Chrome 視窗讓你繼續操作


if __name__ == "__main__":
    main()
