# 正式站：腾讯云 COS + CDN（cmf.ceetang.com）

单文件站点用对象存储最划算：不用管进程、不用管并发，几百 KB 走 CDN 后基本是毫秒级。

**存储桶**：`<your-bucket>`（形如 `yourname-1250000000`，后缀是腾讯云 APPID），地域 `ap-guangzhou`（广州），权限「公有读私有写」。

> 下面出现的 `<your-bucket>` 都替换成你自己的桶名；`<SecretId>` 用子账号密钥，只给这个桶的写权限，不要用主账号。

## 建桶时的选项（已确定，记录备查）

| 项 | 选 | 备注 |
|---|---|---|
| 地域 | 中国-广州 | 与 CDN 同区域，回源快 |
| 数据冗余 | 单 AZ | 多 AZ 贵一点；单 AZ 不可逆，但文件有源可重建 |
| 访问权限 | 公有读私有写 | 私有读会让 CDN 回源 403；公有读写会被人塞文件 |
| 默认告警 | 开 | 每分钟 5000MB 外网流量告警，防刷 |
| 内容安全 | 关 | 只放自己的构建产物 |
| 版本控制 | 关 | 发版靠覆盖，开了会无限累积历史副本 |
| 服务端加密 | 不加密 | 公开静态文件加密没有保护意义 |
| 极智压缩 | 关 | 只压图片，桶里只有 HTML |
| 日志存储 | 关 | 看访问应该看 CDN 日志，比这里全面 |

## 1. 上传 + 改 Content-Type（关键）

上传的是 `dist/site/` **整个目录**，不是只有 `index.html`。目录里每个文件都有用途：

| 文件 | 作用 | 缺了会怎样 |
|---|---|---|
| `index.html` | 工具本体（内联了 JS / CSS） | 打不开 |
| `about.html` | 工具介绍页（获客 / SEO 落地页） | 介绍页 404 |
| `og-cover.png` | 1200×630 分享图 | 微信 / 飞书分享没缩略图 |
| `favicon.ico` / `favicon-32.png` / `icon.svg` | 站点图标 | 标签页、收藏夹空白 |
| `apple-touch-icon.png` | iOS 添加到主屏幕的图标 | iOS 图标是网页截图 |
| `robots.txt` | 抓取规则 + sitemap 地址 | 搜索引擎不知道有 sitemap |
| `sitemap.xml` | 两个页面的收录清单 | 收录慢 |
| `404.html` | 轻量错误页 | 任何 404 都回退整页，浪费 700KB 流量 |

桶 → 文件列表 → 上传文件，存储类型用默认的**标准存储**。

上传后点开 `index.html` 看元信息，**必须确认 `Content-Type` 是 `text/html; charset=utf-8`**。
COS 有时会按 `application/octet-stream` 存，浏览器就会“下载文件”而不是打开页面 —— 这是这条路上 90% 的翻车原因。传错了在对象详情里直接改，不用重传。

命令行方式（可进 CI）：

```bash
pip install coscmd
coscmd config -a <SecretId> -b <your-bucket> -r ap-guangzhou

# -r 递归，把 site 目录里的 9 个文件一起传上去
coscmd upload -r dist/site/ /

coscmd info /index.html | grep -i content-type
```

> `index.html` 对象建议同时设置 `Cache-Control: no-cache`。CDN 的缓存规则按路径匹配，根路径 `/` 和 `index.html` 是两条，只在 CDN 配一边容易漏。

## 2. 开静态网站

存储桶 → 基础配置 → 静态网站 → 开启

- 索引文档：`index.html`
- 错误文档：`404.html`

> 早期这里填的是 `index.html`，任何不存在的路径都会回退整页（697KB）。`favicon.ico`、`robots.txt` 这类抓取请求一旦落空，每次都要传一整页 HTML，既浪费流量，爬虫也拿不到有效内容。换成独立的 `404.html` 后，只有真正的前端路由才需要回退 —— 这个工具只用 `?doc=` 查询参数，没有路径路由，不需要回退。
- **强制 HTTPS：保持关闭**

> 为什么关：CDN 回源默认走 HTTP，源站若强制 HTTPS 会回 301，而 CDN 不跟随 301，结果是访问 5xx。强制跳转要开在 CDN 那一层。

## 3. 用 curl 自测（不要用浏览器）

⚠️ **2024 年 1 月 1 日后新建的桶，默认域名禁止在浏览器里预览**（会强制下载）。所以自测只能用 curl 看响应头：

```bash
curl -I http://<your-bucket>.cos-website.ap-guangzhou.myqcloud.com/
```

期望：`HTTP/1.1 200` + `Content-Type: text/html`。
看到 `403` 说明桶权限不是公有读；看到 `404` 说明静态网站没开或文件名不是 `index.html`。

上线后逐项过一遍（应该全是 200）：

```bash
for p in / /about.html /robots.txt /sitemap.xml /favicon.ico /og-cover.png /404.html; do
  printf "%-18s" "$p"
  curl -sS -o /dev/null -w "%{http_code}  %{content_type}  %{size_download}\n" "https://cmf.ceetang.com$p"
done
```

再确认压缩真的生效（要看 `Content-Encoding: gzip`，且 `Content-Length` 明显小于 697KB）：

```bash
curl -sS -I -H "Accept-Encoding: gzip, br" https://cmf.ceetang.com/ | grep -i "content-encoding\|content-length\|cache-control"
```

## 4. 绑 CDN 域名

1. 存储桶 → 域名与传输管理 → 自定义 CDN 加速域名 → 添加 `cmf.ceetang.com`
2. 源站填**静态网站域名**：

   ```
   ✅ <your-bucket>.cos-website.ap-guangzhou.myqcloud.com
   ❌ <your-bucket>.cos.ap-guangzhou.myqcloud.com
   ```

   少了 `-website` 就没有索引文档与 404 回退，表现为「首页打不开、但直接访问 /index.html 能开」。或者在 CDN 里选「对象存储」源站并勾选「静态网站」。
3. 上传 SSL 证书（腾讯云有免费 DV 证书）
4. **CDN → HTTPS 配置 → 强制跳转 HTTPS：开启**（对外的那一层，开在这里才对）
5. 缓存配置（**两条都要配，只配一条容易漏**）：
   - `/` 与 `*.html`：**不缓存 / 0 秒**。单文件里已内联 JS/CSS，HTML 一换就是新版本，缓存住就会「发版了用户还是老样子」。
   - `*.png` / `*.ico` / `*.svg`：7 天。图标和分享图不常变，没必要每次回源。
6. 压缩（**必开，收益最大的一步**）：
   CDN → 高级配置 → 智能压缩，打开 gzip（有 brotli 就一起开）。
   文件类型至少勾：`text/html`、`text/css`、`application/javascript`、`application/json`、`image/svg+xml`、`application/xml`、`text/plain`。
   697KB 的 HTML 压完约 219KB，首屏直接少下 470KB。没开压缩时，控制台看到的 `Content-Length` 和源文件一样大。

## 5. DNS

```
类型  CNAME
主机  cmf
值    cmf.ceetang.com.cdn.dcdn...（控制台给的 CNAME 值，整串复制，别自己拼）
```

绑定 CDN 域名要求域名已备案，已备案不会被拦。

## 6. 以后发版

```bash
npm run build:single
coscmd upload -r dist/site/ /           # 递归覆盖同名对象，秒级
```

`dist/site/` 里是 9 个文件，`-r` 会把新加的 `about.html`、`404.html` 一起带上去；只传 `index.html` 会漏。

发版后想立刻生效：CDN 控制台 → 刷新 URL，把 `https://cmf.ceetang.com/` 和 `https://cmf.ceetang.com/about.html` 各刷一次（HTML 设为不缓存的话通常不用刷，但换过缓存规则后第一次建议手动刷）。

新增了页面时，`sitemap.xml` 里的 `lastmod` 要跟着改，再回百度站长 / Search Console 重新提交一次 sitemap。

## 7. 旧桶下线

新桶验证通过、`cmf.ceetang.com` 已经指向新源站后：

1. 旧桶先**关闭静态网站**（直接删会让正在访问的人立刻 404）
2. 观察一两天，确认没有别的链接在用它
3. 再删除桶

## 8. 和服务器方案怎么分工

```
test.cmf.ceetang.com  →  A：服务器（/var/www/cmf-test，nginx.conf 换 server_name 即可）
cmf.ceetang.com       →  B：COS + CDN（正式，对外）
```

先在 `test.` 上把这一版验完（导出、导入工程、粘贴图），确认没问题再推到正式。
两套环境的 localStorage 相互独立，换域名打开看不到旧存档，属正常。
