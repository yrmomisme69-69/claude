# Apple 香港有貨提醒

定時查詢你指定型號的**門市取貨**和**送貨**狀態，一有貨就響聲並寄 Gmail 通知你，由你親手購買。

- 只查詢，不購買、不登入、不開瀏覽器。
- 每 3–5 分鐘查一次（程式硬性下限 60 秒），每次只發一個細小的查詢。
- 如果 Apple 拒絕查詢，工具會自動放慢到最多 30 分鐘一次，並通知你。它不會偽裝或繞過 Apple 的偵測。
- 另有「開賣提醒」：到時間準時通知你，這部分完全不會連 Apple。

## 安裝

```bash
cd apple_stock_alert
python3 -m pip install -r requirements.txt
cp config.example.yaml config.yaml
```

> 如果出現 `CERTIFICATE_VERIFY_FAILED`（SSL 證書錯誤），是因為 python.org 版的 Python 在 macOS 預設沒有根證書。
> 用上面的 `pip install` 裝好 `certifi` 就會自動處理。你也可以執行一次 `/Applications/Python 3.13/Install Certificates.command`。

Gmail 設定可以直接照抄 `apple_hk_bot/config.yaml` 的 `email:` 部分。然後執行 `python3 stock_alert.py --test-email` 確認收到測試信。

## 第一步：找型號編號

Apple 查貨要用型號編號，香港版以 `ZA/A` 或 `ZP/A` 結尾。在 Terminal 執行：

```bash
python3 stock_alert.py --find-parts "https://www.apple.com/hk/shop/buy-iphone/iphone-18-pro"
```

它會列出編號和對應的顏色、容量，把你要的那個填入 `config.yaml` 的 `parts`。

如果這一步被 Apple 擋了，可以改用 Safari 手動找：

1. 打開購買頁。
2. 在選單按「開發」→「顯示網頁原始碼」。如果沒有「開發」選單，先到 Safari 設定 →「進階」，剔選「顯示網頁開發者功能」。
3. 按 ⌘F 搜尋 `ZA/A`。

## 第二步：試查一次

```bash
python3 stock_alert.py --once --debug
```

- 會列出每間門市和送貨的狀態，例如 `✅ 有貨` 或 `❌ 冇貨`。
- 知道門市名稱後，可以在 `stores` 填你想要的門市，例如 `["銅鑼灣", "新城市廣場"]`。
- `--debug` 會把 Apple 的原始回覆存到 `last_response.json`。如果結果看起來不對，可以把這個檔案交給 Claude 檢查格式。

## 第三步：開始監察

```bash
caffeinate -i python3 stock_alert.py
```

`caffeinate` 會防止 Mac 休眠。按 `Ctrl + C` 停止。

## 通知規則

- 由「冇貨」變成「有貨」時通知一次。
- 之後再次冇貨，然後又補貨，會再通知。
- 第一次查詢已經有貨，也會通知你。
- 新機開賣期間通常一直「可以送貨」，只是送貨時間較長。如果你只在乎門市取貨，可以把 `check_delivery` 改成 `false`。

## 只提醒模式（Apple 拒絕查詢時用）

在實測中，Apple 對這個工具的查詢回傳了 HTTP 541，即是拒絕。如果持續被拒，可以改用只提醒模式。它完全不連 Apple，只會在開賣前準時響聲並寄 email 給你：

1. 在 `config.yaml` 填好 `launch_reminder.time`，例如 `"2026-10-10T20:00:00+08:00"`。
2. 在 Terminal 執行：
   ```bash
   caffeinate -i python3 stock_alert.py --reminder-only
   ```

你也可以在 `config.yaml` 設定 `check_stock: false`，效果一樣。

## 限制

- Apple 查貨網址 `/shop/fulfillment-messages` 不是公開的正式介面，隨時可能更改或拒絕查詢。遇到這種情況，工具會通知你，你可以改用 Apple Store App 手動查看。
- iPhone Duo 要等 Apple 正式上架，才會有型號編號。
