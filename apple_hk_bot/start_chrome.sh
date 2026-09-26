#!/bin/bash
# 開一個「專用」的 Chrome 視窗，讓腳本可以接上去操作。
# 第一次開啟時，請在這個視窗登入 apple.com/hk 的 Apple ID，之後會一直記住。
# （Chrome 136 之後不允許用預設個人檔案做遙距控制，所以要用獨立資料夾。）

PORT="${PORT:-9222}"
PROFILE_DIR="$HOME/.apple-hk-bot-chrome"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -x "$CHROME" ]; then
  echo "找不到 Google Chrome，請先安裝：https://www.google.com/chrome/"
  exit 1
fi

"$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  "https://www.apple.com/hk/shop/bag" >/dev/null 2>&1 &

echo "已開啟專用 Chrome（port $PORT）。"
echo "第一次使用請先在該視窗登入 Apple ID，然後保持視窗開啟。"
