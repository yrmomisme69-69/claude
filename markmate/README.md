# MarkMate 改卷

影低功課或者上載 PDF，AI 幫你改：

- **選擇題**：用藍筆圈出正確答案，答錯打紅色 ✗
- **長題目 / 計算題**：打紅色 ✓ 或 ✗，部分正確會寫分數（例如 1/3），指出第一個出錯位
- **每一題**都有解釋：點解錯、正確做法、下次點避免（數學公式會正確顯示）
- **有答案**就跟你嘅答案改；**冇答案** AI 會自己計，唔肯定嘅題目用黃色「?」標出
- 支援 **相片、PDF（GoodNotes 匯出）、直接打字**
- 記號位置有少少偏？可以用「調整記號位置」拖返去
- 可以**下載改好嘅圖片**，或者**列印 / 儲存做 PDF**（連埋全部解釋）

> 第一版係網站（手機、iPad、電腦都用到），之後可以包裝成 App Store app，睇最尾「下一步」。

---

## 上線步驟（唔使識寫 code，大約 20 分鐘）

你需要三樣嘢：一個 **GitHub** 帳戶（放 code）、一個 **Vercel** 帳戶（免費放網站）、一條 **Claude API key**（俾 AI 改卷用）。

### 第 1 步：攞 Claude API key

1. 去 <https://platform.claude.com>，用電郵登記。
2. 去 **Billing** 增值少少（例如 US$5 試用）。
3. 去 **API keys** → **Create key**，複製嗰條 `sk-ant-...` 開頭嘅 key，**唔好俾任何人睇**。

**成本參考**：預設用 Claude Sonnet 5.5，價錢係每百萬 token 輸入 US$2、輸出 US$10。一頁功課大約用幾千個 token，粗略估計 **每頁約 US$0.03–0.08**（題目越多、解釋越長就越貴）。實際用量可以喺 Console 嘅 Usage 頁睇。

### 第 2 步：將 code 放上 GitHub

1. 解壓縮 `markmate.zip`。
2. 登入 <https://github.com>，右上角 **+** → **New repository**，名叫 `markmate`，揀 **Private**，撳 **Create repository**。
3. 喺新 repo 頁面撳 **uploading an existing file**。
4. 打開解壓咗嘅 `markmate` 資料夾，**揀晒入面所有檔案同資料夾**（`app`、`components`、`lib`、`public`、`scripts`、`package.json` 等等），拖入 GitHub 頁面。
5. 等上載完，撳 **Commit changes**。

### 第 3 步：用 Vercel 上線

1. 去 <https://vercel.com>，揀 **Continue with GitHub** 登記。
2. 撳 **Add New… → Project**，喺列表搵 `markmate`，撳 **Import**。
3. 打開 **Environment Variables**，加：
   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | 第 1 步嘅 key |
   | `ACCESS_CODE` | 自己諗一個密碼（建議加，防止陌生人用你嘅額度） |
   | `DAILY_BUDGET_USD` | 全站每日最多用幾多美金，例如 `2`（約 HK$15） |
   | `ADMIN_CODE` | 另一個密碼，用嚟睇用量頁 |
4. 撳 **Deploy**，等一兩分鐘，就會有條網址，例如 `https://markmate-xxxx.vercel.app`。

之後改咗設定（例如換密碼），要去 Vercel 嘅 **Deployments → ⋯ → Redeploy** 先會生效。

### 第 4 步：設好「防爆額度」三重保險（強烈建議）

1. **Claude Console 每月消費上限**：喺 Console 嘅帳單設定入面搵 spend limit，設一個你蝕得起嘅金額。呢個係最硬嘅保險，就算網站出咩事都唔會超過。
2. **網站每日上限**：上面嘅 `DAILY_BUDGET_USD`。網站按每次改卷嘅真實 token 用量計錢，到咗上限就停，香港時間凌晨 12 點自動重置。
3. **連接 Upstash Redis（免費）**：冇佢嘅話，用量記喺伺服器記憶體，重新部署會清零。連接方法：
   - 喺 Vercel 項目入面揀 **Storage**（或者 Marketplace），揀 **Upstash Redis**，用免費方案建立，再連接去 `markmate` 項目。
   - Vercel 會自動加好所需嘅環境變數。之後 **Redeploy** 一次。

設好之後，開 `https://你嘅網址/admin`，輸入 `ADMIN_CODE`，就睇到今日用咗幾多錢、改咗幾多頁、每頁平均成本同最近 7 日紀錄。如果頁面顯示「用緊伺服器記憶體記數」，即係 Upstash 未連接好。

### 第 5 步：放落手機主畫面

用 iPhone / iPad 嘅 **Safari** 開條網址 → 撳分享掣 → **加入主畫面**。之後佢會好似一個 app 咁開。

### 已經上咗線？更新新版本

1. 解壓新嘅 `markmate.zip`。
2. 去你嘅 GitHub repo，撳 **Add file → Upload files**，再揀晒入面所有檔案同資料夾拖入去（同名檔案會自動覆蓋）。
3. 撳 **Commit changes**。Vercel 會自動重新部署，一兩分鐘後就係新版本。
4. 如果新版本有新嘅環境變數（例如 `DAILY_BUDGET_USD`、`ADMIN_CODE`），記得喺 Vercel 加返，再 Redeploy。

---

## 點樣用得最好

- **GoodNotes**：打開筆記 → 分享 → 匯出 → **PDF**，再喺 MarkMate 揀嗰個 PDF。匯出前確認手寫有包埋喺 PDF 入面。
- **影相**：成頁放平、光線夠、唔好有陰影，一頁一張相最準。
- **答案**：可以影答案頁、上載答案 PDF，或者直接打（例如 `1. B 2. D 3. $40`）。AI 讀到嘅答案會顯示出嚟俾你檢查。
- **改卷設定 → 其他要求**：例如「答案取 3 位有效數字」、「作文用 IELTS band 評分」、「解釋寫詳細啲」。
- AI 都會出錯，尤其係冇答案、字跡潦草或者好難嘅題目。黃色「?」嘅題目要自己再核對。

---

## 設定一覽（Vercel → Settings → Environment Variables）

| 名稱 | 必須？ | 用途 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 必須 | Claude API key |
| `ACCESS_CODE` | 建議 | 入場密碼，冇設就任何人都用到 |
| `DAILY_BUDGET_USD` | 建議 | 全站每日最多用幾多美金，預設 `2`。`0` = 唔設上限 |
| `ADMIN_CODE` | 建議 | 管理員密碼，用嚟開 `/admin` 用量頁 |
| `DAILY_PAGE_LIMIT` | 選填 | 每個人（IP）每日最多改幾多頁，預設 40 |
| Upstash Redis | 建議 | 喺 Vercel Storage 連接，會自動加 `KV_REST_API_URL` / `KV_REST_API_TOKEN`（或 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`） |
| `APP_TIMEZONE` | 選填 | 每日重置用嘅時區，預設 `Asia/Hong_Kong` |
| `CLAUDE_MODEL` | 選填 | 預設 `claude-sonnet-5-5`。想平好多可以改 `claude-haiku-5-5`（約平 20 倍，但難題冇咁準）；想更準可以改 `claude-opus-5-5`（約貴一倍） |
| `CLAUDE_EFFORT` | 選填 | `low` / `medium` / `high`，預設 `medium`。越高越準但越慢越貴 |

---

## 想俾大眾用？

而家已經有：入場密碼、每人每日頁數上限、全站每日金額上限、用量頁、API key 只放喺伺服器（用家睇唔到）。但正式公開之前仲要：

1. **用戶登入**：例如 Clerk 或 Supabase Auth，每個人有自己嘅額度。
2. **以人計嘅限額**：而家每人上限係按 IP 計，轉網絡就可以繞過。有登入之後應該改為按帳戶計。
3. **收費**：每改一頁都要俾 API 錢。可以免費每日幾頁，再用 Stripe 收月費。上 App Store 嘅話，app 內收費一般要用 Apple 嘅 In-App Purchase。
4. **私隱政策同使用條款**：講清楚相片會傳去 Anthropic 處理、唔會儲存。
5. Vercel 免費 Hobby 計劃只限個人、非商業用途；開始收錢要轉 Pro。

---

## 下一步：上 App Store

路線建議：先用網站版收集意見 → 再加 App 專屬功能 → 用 **Capacitor** 將網站包裝成 iOS app。

- 需要一部 **Mac**（裝 Xcode）同 **Apple Developer Program** 會籍（每年年費）。
- Apple 審批對「淨係包住網站」嘅 app 比較嚴，所以上架前最好加啲 app 先有嘅功能，例如：錯題簿（離線儲存）、溫習提醒通知、相機自動裁切。
- 呢啲都可以叫 Claude Code 幫你做，`CLAUDE.md` 已經寫好開發方向。

---

## 用 Claude Code 繼續開發

1. 喺電腦裝 [Node.js](https://nodejs.org)（20 或以上）同 Claude Code（安裝方法：<https://docs.claude.com/en/docs/claude-code/overview>）。
2. 喺 terminal 入去 `markmate` 資料夾：
   ```bash
   npm install
   cp .env.example .env.local   # 打開 .env.local 填返 ANTHROPIC_API_KEY
   npm run dev                  # 打開 http://localhost:3000
   ```
3. 喺同一個資料夾打 `claude`，就可以叫佢改。例子：
   - 「加一個錯題簿，將答錯嘅題目儲喺瀏覽器，可以按科目重溫」
   - 「喺解釋旁邊加一個『追問』輸入框，可以問 AI 呢題點解唔係 B」
   - 「答錯嘅題目，加一個掣生成一條類似但數字唔同嘅練習題」
4. 改完 push 上 GitHub，Vercel 會自動更新網站。

---

## 檔案結構

```
app/page.tsx              主畫面（上載、改卷流程、結果）
app/api/grade/route.ts    改一頁：將相片同答案傳俾 Claude，返回每題結果同座標
app/api/answer-key/route.ts  讀答案頁，轉做文字
app/admin/page.tsx        用量頁（要 ADMIN_CODE）
lib/server/usage.ts       每日上限同用量紀錄（Upstash Redis，冇就用記憶體）
lib/server/pricing.ts     Claude 價錢表，用嚟計每次改卷幾錢
components/PageView.tsx   喺相片上畫 ✓ ✗、藍圈、批註
components/QuestionDetail.tsx  每題嘅詳細解釋
lib/prompts.ts            俾 AI 嘅改卷指引（想改評分標準就改呢度）
lib/schema.ts             AI 回覆嘅格式
lib/imageSizing.ts        將相片調到 Claude 用嘅準確尺寸，令座標對得準
public/demo/              示範卷
```
