# PRISM｜直达按揭比较

比较「PRISM 直达」与「中介渠道」两份按揭方案的总成本（参赛示范原型）。

- 纯 HTML + JavaScript，单一文件 `docs/index.html`，不需要服务器运算，也不依赖任何外部网站（没有 CDN、字体或统计脚本），所以只要能打开网址就能用。
- 默认简体中文，右上角一键切换繁體；也可以用网址参数指定：`?lang=hans`（简体）、`?lang=hant`（繁體）。
- 计算逻辑与原版完全相同（已用 3000 组随机输入逐一比对，结果一模一样）。
- 兼容较旧的手机浏览器、微信及国产浏览器。

## 上线（GitHub Pages，免费）

1. 打开仓库 **Settings → Pages**。
2. **Source** 选 **Deploy from a branch**。
3. **Branch** 选 `main`，文件夹选 `/docs`，按 **Save**。
4. 等一两分钟，网址会是：`https://yrmomisme69-69.github.io/claude/`

> 想要更好看的网址：把仓库改名（例如 `prism`），网址就会变成 `https://yrmomisme69-69.github.io/prism/`。

## 备用网址（可选，Cloudflare Pages）

如果某些地区打开 github.io 较慢，可以多放一份作备用：

1. 注册 / 登录 <https://dash.cloudflare.com>，进入 **Workers & Pages → Create → Pages → Upload assets**。
2. 把 `docs` 文件夹拖进去上传。
3. 会得到 `xxx.pages.dev` 网址，两个网址内容相同。

## 本地预览

直接双击 `docs/index.html` 用浏览器打开即可。

## 修改内容时要注意

- 用普通文字编辑器（例如 VS Code）修改，保存为 **UTF-8** 编码。
- 不要从 ChatGPT 聊天窗口直接选取复制代码，要用代码框右上角的「复制」按钮，否则会混入 ``` 等 Markdown 符号，或者换行被吃掉，导致整个脚本失效。
