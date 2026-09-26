# Apple 香港官網半自動購買腳本

腳本會等到開賣時間，然後自動做以下步驟：

1. 以溫和、隨機的頻率刷新商品頁
2. 點選型號、顏色、容量
3. 加入購物袋，進入結帳
4. 自動填寫送貨資料
5. **停在付款頁**，用 email 和 Mac 提示音通知你

最後的付款和「下訂單」由你親手完成。腳本有安全網，永遠不會按這些按鈕。

## 防封鎖的設計

| 做法 | 原因 |
|---|---|
| 接上你自己的 Chrome（已登入 Apple ID） | 有真實的 cookies 和登入記錄，比全新的自動化瀏覽器自然 |
| 開賣前完全不發請求 | 不會長時間不停刷新 |
| 刷新間隔隨機，硬性下限 5 秒 | 平時 30–60 秒一次，只在開賣前後幾分鐘加快到 8–15 秒 |
| 疑似被限流時自動退避 | 暫停 1 分鐘、2 分鐘…最長 10 分鐘，避免越刷越嚴重 |
| 遇到驗證碼、登入、卡住都會暫停並通知你 | 由你親手處理，腳本不會嘗試破解 |
| 一個帳號、一個視窗、家中網絡 | 不用代理，也不用多個帳號 |

## 安裝（只需做一次）

```bash
# 1. 安裝 Python 套件
cd apple_hk_bot
python3 -m pip install -r requirements.txt

# 2. 建立你自己的設定檔
cp config.example.yaml config.yaml
open -e config.yaml        # 用「文字編輯」打開修改
```

### 設定檔是什麼？

`config.yaml` 是腳本讀取的設定，包括：

- 要買哪款、什麼顏色和容量
- 開賣時間
- 結帳時要填的**聯絡資料**，即姓名、電話、email、送貨地址
- 用來通知你的 email 帳戶

檔案只會留在你的 Mac，已設定不會上傳到 GitHub。信用卡資料**不要**寫進去。

如果你的 Apple ID 已儲存送貨地址，結帳頁通常會自動帶出。腳本只會填**空白**的欄位，所以設定檔的地址只是後備。

### 設定 Gmail 通知

1. 開啟 Google 帳戶的兩步驗證。
2. 到 Google 帳戶 → 安全性 → **應用程式密碼**，建立一個新密碼，會得到 16 個字母。
3. 把它填入 `config.yaml` 的 `app_password`，並填好 `username` 和 `to`。
4. 執行 `python3 bot.py --test-email`，收到測試信就代表設定正確。

## 第一次開啟專用 Chrome 並登入

```bash
./start_chrome.sh
```

這會開啟一個**專用**的 Chrome 視窗，資料存在 `~/.apple-hk-bot-chrome`，和你平常用的 Chrome 分開。

> ⚠️ **App Store 已登入不等於網頁已登入。** 你需要在這個 Chrome 視窗登入 **apple.com/hk** 的 Apple ID，登入一次之後就會記住。建議順便在 Apple ID 儲存送貨地址。

腳本運行期間請保持這個視窗開啟，而且只開一個分頁。

## 第一步：用 iPhone 18 Pro 測試

`config.yaml` 的預設網址已經是 iPhone 18 Pro，`launch_time` 留空代表立即開始。

```bash
# 測試 A：只測試選購，加入購物袋後就停
python3 bot.py --stop-after bag

# 測試 B：完整流程，會停在付款頁，不會下單
python3 bot.py
```

- 如果腳本找不到你寫的選項，會把網頁上所有選項列出並 email 給你。照抄到 `options` 即可，英文大小寫不影響。
- 測試完成後，記得到購物袋把 iPhone 18 Pro 移除。

## 正式使用：iPhone Duo 開賣日

1. Apple 公佈開賣時間和購買頁網址後，修改 `config.yaml`：
   ```yaml
   product_url: "https://www.apple.com/hk/shop/buy-iphone/iphone-duo"   # 以實際網址為準
   launch_time: "2026-10-10T20:00:00+08:00"                            # 以實際時間為準
   options:
     - "iPhone Duo"
     - "你想要的顏色"
     - "256GB"
     # ……
   ```
2. 開賣前半小時做以下準備：
   ```bash
   ./start_chrome.sh                # 確認仍然登入
   caffeinate -i python3 bot.py     # caffeinate 防止 Mac 休眠
   ```
3. 留在電腦旁。收到「💳 已到付款頁」通知後，立即到 Chrome 視窗付款。

## 腳本會在什麼時候叫你？

| 通知 | 你要做什麼 |
|---|---|
| ⚠️ 出現驗證碼 | 在 Chrome 視窗完成驗證，腳本會自動繼續 |
| 🔑 需要登入 Apple ID | 在 Chrome 視窗登入，腳本會自動繼續 |
| ⚠️ 自動選購未成功 | 親手選好並加入購物袋，腳本會接手結帳 |
| ⚠️ 結帳卡住了 | 親手完成那一步並按繼續，腳本會接手 |
| 💳 已到付款頁 | **親手付款並下訂單** |

在 Terminal 按 `Ctrl + C` 可以隨時停止。停止後 Chrome 視窗不會關閉。

## 注意事項

- Apple 每次改版都可能改網頁結構。腳本主要靠按鈕文字辨認，大部分改動都能應付。萬一失效，它會暫停並通知你親手接手，不會亂按。
- 用自動化工具購物可能違反網站的使用條款。請只用於購買自用的一件商品，並自行承擔風險。
- `start_chrome.sh` 開啟的遙距控制端口只限本機連接，但用完後最好關閉那個 Chrome 視窗。
