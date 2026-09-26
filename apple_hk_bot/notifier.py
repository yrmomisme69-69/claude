"""通知：Email（主要）＋ Mac 提示音／通知中心（輔助，因為 email 可能慢幾秒）。"""

import smtplib
import subprocess
import sys
import threading
from datetime import datetime
from email.mime.text import MIMEText
from email.utils import formatdate


class Notifier:
    def __init__(self, cfg):
        self.email = cfg.get("email") or {}
        self.mac_alert = cfg.get("mac_alert", True) and sys.platform == "darwin"

    def notify(self, subject, body="", urgent=False, wait=False):
        stamp = datetime.now().strftime("%H:%M:%S")
        print(f"\n🔔 [{stamp}] {subject}\n{body}\n", flush=True)
        if self.mac_alert:
            self._mac(subject, urgent)
        if self.email.get("enabled"):
            # 在背景寄出，不阻住搶購流程
            t = threading.Thread(target=self._send_email, args=(subject, body), daemon=not wait)
            t.start()
            if wait:
                t.join()

    def _mac(self, subject, urgent):
        safe = subject.replace('"', "'")
        subprocess.Popen(["osascript", "-e", f'display notification "{safe}" with title "Apple HK Bot" sound name "Glass"'])
        if urgent:
            # 連續響幾次，確保你聽到
            subprocess.Popen(["bash", "-c", "for i in 1 2 3 4 5; do afplay /System/Library/Sounds/Sosumi.aiff; done"])

    def _send_email(self, subject, body):
        cfg = self.email
        msg = MIMEText(f"{body}\n\n時間：{datetime.now():%Y-%m-%d %H:%M:%S}", "plain", "utf-8")
        msg["Subject"] = f"[Apple HK Bot] {subject}"
        msg["From"] = cfg["username"]
        msg["To"] = cfg.get("to") or cfg["username"]
        msg["Date"] = formatdate(localtime=True)
        try:
            with smtplib.SMTP_SSL(cfg.get("smtp_host", "smtp.gmail.com"), int(cfg.get("smtp_port", 465)), timeout=20) as s:
                s.login(cfg["username"], cfg["app_password"])
                s.send_message(msg)
            print(f"   ✉️  已寄出 email：{subject}", flush=True)
        except Exception as e:  # 通知失敗不應令搶購中斷
            print(f"   ⚠️  寄 email 失敗：{e}", flush=True)
