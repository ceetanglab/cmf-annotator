#!/usr/bin/env bash
# 把 dist/site/index.html 发到服务器（预发 / 正式都能用）
#
# 用法：
#   SERVER=root@1.2.3.4 WEBROOT=/var/www/cmf ./deploy/upload.sh
#   SERVER=root@1.2.3.4 WEBROOT=/var/www/cmf-test DOMAIN=test.cmf.ceetang.com ./deploy/upload.sh
#
# 可选环境变量：
#   RELOAD=1        传完顺手 nginx -t && reload（改了配置才需要）
#   SKIP_BUILD=1    跳过打包，直接传现有产物
#   SSH_PORT=22     非默认端口
set -euo pipefail

SERVER="${SERVER:?请设置 SERVER，例如 root@1.2.3.4}"
WEBROOT="${WEBROOT:-/var/www/cmf}"
SSH_PORT="${SSH_PORT:-22}"
LOCAL="dist/site/index.html"
DOMAIN="${DOMAIN:-cmf.ceetang.com}"

if [ -z "${SKIP_BUILD:-}" ]; then
  echo "→ 打包（typecheck + 单文件）"
  npm run typecheck
  npm run build:single
fi

if [ ! -f "$LOCAL" ]; then
  echo "✖ 找不到 $LOCAL，先跑 npm run build:single"
  exit 1
fi

SIZE=$(du -h "$LOCAL" | cut -f1)
SSH_OPTS=(-p "$SSH_PORT")

echo "→ 上传 $SIZE 到 $SERVER:$WEBROOT"
ssh "${SSH_OPTS[@]}" "$SERVER" "mkdir -p '$WEBROOT'"

# 先传临时文件再 mv：避免访问者在替换瞬间读到半个文件
scp -P "$SSH_PORT" "$LOCAL" "$SERVER:$WEBROOT/index.html.new"
ssh "${SSH_OPTS[@]}" "$SERVER" "mv '$WEBROOT/index.html.new' '$WEBROOT/index.html' && chmod 644 '$WEBROOT/index.html'"

echo "✔ 文件已替换"

if [ -n "${RELOAD:-}" ]; then
  echo "→ 检查并重载 nginx"
  ssh "${SSH_OPTS[@]}" "$SERVER" "nginx -t && systemctl reload nginx"
fi

echo "→ 线上校验 https://$DOMAIN/"
curl -sS -o /dev/null -w "  HTTP %{http_code}  %{size_download} bytes  %{time_total}s\n" "https://$DOMAIN/" || {
  echo "  ⚠ 校验失败：DNS 没生效 / 证书没签 / 服务没起，三者之一"
}
