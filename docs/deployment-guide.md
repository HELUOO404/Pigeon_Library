# 部署指南（Deployment Guide）

> 如何在本地、静态主机、以及 Windows Server 上运行 PigeonLib。
> 架构前提:**前端本地优先、可离线;后端是可选同步层**(见 [`user-system-design.md`](./user-system-design.md))。所以你有两条部署路径——只发前端(纯静态),或前端 + 可选后端(开启跨设备同步)。

## 目录

1. [前置条件](#一前置条件)
2. [本地开发](#二本地开发)
3. [生产构建 + 静态托管(仅前端)](#三生产构建--静态托管仅前端)
4. [可选:同步后端部署](#四可选同步后端部署)
5. [Windows Server 部署](#五windows-server-部署)
6. [前端 ↔ 后端对接(CORS / cookie / API 基址)](#六前端--后端对接cors--cookie--api-基址)
7. [排错](#七排错)

---

## 一、前置条件

- **Node.js ≥ 22.5**(后端用到内置 `node:sqlite`,该版本起可用且稳定;前端 Vite 也需要较新 Node)。`node -v` 确认。
- npm(随 Node 安装)。
- 仅发前端时,**运行环境不需要 Node**——只要一个能托管静态文件的 HTTP 服务器。

> **不能直接双击 `app/index.html`(`file://`)**:Chrome 在 `file://` 下禁止 ES 模块与本地 `fetch`,页面无法渲染。必须经 HTTP 源访问。

---

## 二、本地开发

```bash
# 1) 打包内置课程(首次或课程内容变更后)
node tools/build-pigeon.mjs ic-packaging        # → dist-courses/ic-packaging.pigeon

# 2) 起前端开发服务器
cd app
npm install
npm run dev                                      # → http://localhost:5173
```

最快:双击仓库根的 **`启动PigeonLib.bat`**(自动完成上面两步并打开浏览器)。

可选起后端(开启登录与同步):

```bash
cd server
npm install
cp .env.example .env
npm start                                        # → http://localhost:8787
```

开发态前端(5173)会自动把 API 指向后端(8787),见 [§六](#六前端--后端对接cors--cookie--api-基址)。

---

## 三、生产构建 + 静态托管(仅前端)

```bash
# 构建顺序很重要:先打包课程,再构建前端
node tools/build-pigeon.mjs ic-packaging
cd app && npm run build                           # → app/dist/
```

`app/dist/` 是**完全自包含的静态站点**(含 `index.html` / `learn.html` / `admin.html` + assets + 内置课程 + 文档)。把整个 `app/dist/` 目录交给任意静态服务器即可:

- **Nginx**:`root /var/www/pigeonlib/dist;`
- **任意静态托管**(GitHub Pages / Netlify / Vercel / 对象存储 + CDN):上传 `app/dist/` 内容。
- **本机快速预览**:`cd app && npm run preview`,或 `npx serve app/dist`。

> **注意构建顺序**:若构建时 `dist-courses/ic-packaging.pigeon` 不存在,`npm run build` 仍成功,但产物**无内置课程**(运行时 `/courses/ic-packaging.pigeon` 404)。务必先打包。

> **课程内容不入版本库**:`.gitignore` 排除了 `courses/` 与 `dist-courses/` 下除 `demo-course` 外的全部课程(含内置课 `ic-packaging` 与 2026 系列)。全新 clone 只有平台代码,课程源与打包产物需另行获取到本机;`app/dist/courses/` 里的课程内容也可脱离站点单独部署到 web 根目录的同名路径。

> **子路径部署**:若部署在 `https://host/pigeonlib/` 这类子路径下,需给 Vite 配 `base`(`vite build --base=/pigeonlib/`)。根路径部署无需改动。

纯静态部署下,用户数据全部留在浏览器本地(访客档案),无跨设备同步——这是完全合法的部署形态。

### 3.1 媒体缓存与原子发布

分离课程的 package、`assets/images`、`assets/media` 与 `delivery-manifest.json` 必须作为一个完整版本发布。推荐使用带字节版本的目录或内容哈希 URL；只有这类不可变 URL 才设置 `Cache-Control: public, max-age=31536000, immutable`。HTML、课程注册表和仍可能原地更新的 URL 必须 revalidate，不得套用 immutable。

发布顺序固定为：上传新版本全部 assets → 上传课程 package/manifest → 最后切换 HTML/注册表引用。至少保留上一完整版本；回滚只切回上一引用，不在原路径逐文件覆盖。上线后以冷缓存和暖缓存各验证一次：图片/首帧 MIME 正确，重复访问不可变 URL 的传输字节为 0；视频响应包含 `Content-Length`、`Accept-Ranges: bytes`，`Range: bytes=0-1023` 返回 `206`、正确 `Content-Range` 与长度。任一资源 404、哈希不一致或 Range 失败都阻断发布。

---

## 四、可选:同步后端部署

后端在 `server/`,技术栈 **Node + Express + `node:sqlite`(内置)+ `bcryptjs`(纯 JS)**,**无原生编译**,部署简单。

```bash
cd server
npm install
cp .env.example .env          # 按需修改(见下)
npm start                     # 默认 http://localhost:8787
```

`.env` 关键项:

| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口(默认 8787) |
| `NODE_ENV` | 设 `production` 时会话 cookie 启用 `Secure`(**需 HTTPS**) |
| `CORS_ORIGINS` | 允许携带 cookie 的前端源,逗号分隔。**生产改成你的前端域名** |
| `TRUST_PROXY` | 本机反向代理。**IIS/Nginx/cloudflared 反代部署设 `loopback`**,仅信任环回代理链中的 `X-Forwarded-For`;否则限流按反代地址归并——一个用户连错几次密码会把全站挡在 429 外。直连公网保持 `0` |
| `SESSION_TTL_DAYS` | 会话有效期(默认 30) |
| `SEED_ADMIN_USER/PASS` | 可选,预置管理员;不设则**首个注册者自动成为管理员**。公网部署建议配置:否则从部署到你注册之间,任何人抢注即拿到管理权 |

数据落 `server/data/pglib.db`(SQLite 单文件)。**这个文件是全部用户数据,务必纳入备份**;`server/data/` 已在 `.gitignore`。

冒烟自测:`npm run smoke`(注册→登录→同步→管理→登出 + 密码哈希断言)。

> **真实管理员口令/密钥由你本机在 `.env` 配置,不要写进仓库。**

---

## 五、Windows Server 部署

目标:静态前端 + 后端作为后台服务常驻,IIS 统一对外、把 `/api` 反代到 Node。

### 5.1 安装

1. 安装 **Node.js ≥ 22.5**(LTS 安装包,勾选加入 PATH)。
2. 把仓库放到服务器,如 `C:\apps\PigeonLib`。
3. 构建前端:
   ```powershell
   node tools\build-pigeon.mjs ic-packaging
   cd app
   npm install
   npm run build            # → app\dist
   ```
4. 装后端依赖:
   ```powershell
   cd ..\server
   npm install
   copy .env.example .env
   ```
   编辑 `.env`:`NODE_ENV=production`、`PORT=8787`、`CORS_ORIGINS=https://你的域名`(同源部署时其实不跨域,见 5.4)、**`TRUST_PROXY=loopback`**(本机反代必须设,否则限流失效见 §四表格)、并建议设 `SEED_ADMIN_USER/PASS` 占住管理员位。

### 5.2 把 Node 后端注册为 Windows 服务(NSSM)

[NSSM](https://nssm.cc/) 让 Node 进程以服务方式常驻、开机自启、崩溃自拉起。

```powershell
# 以管理员 PowerShell 运行
nssm install PigeonLibApi "C:\Program Files\nodejs\node.exe" "C:\apps\PigeonLib\server\index.js"
nssm set PigeonLibApi AppDirectory "C:\apps\PigeonLib\server"
nssm set PigeonLibApi AppStdout "C:\apps\PigeonLib\server\logs\out.log"
nssm set PigeonLibApi AppStderr "C:\apps\PigeonLib\server\logs\err.log"
nssm start PigeonLibApi
```

确认:浏览器访问 `http://127.0.0.1:8787/api/health` 应返回 `{"ok":true}`。

### 5.3 IIS 托管静态前端 + 反代 /api 到 Node

需要 IIS 模块 **URL Rewrite** 和 **Application Request Routing (ARR)**(均为微软官方下载)。

1. 在 IIS 新建站点,物理路径指向 `C:\apps\PigeonLib\app\dist`,绑定域名/端口(生产配 HTTPS 证书)。
2. 开启 ARR 代理:IIS 管理器 → 服务器节点 → *Application Request Routing Cache* → *Server Proxy Settings* → 勾选 **Enable proxy**。
3. 在站点根放 `web.config`,把 `/api/*` 反代到 Node,其余走静态 + SPA 兜底:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- 把 /api/* 反向代理到本机 Node 后端 -->
        <rule name="ProxyApi" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:8787/api/{R:1}" />
        </rule>
        <!-- 其余请求:存在的静态文件直接给,否则回 index.html -->
        <rule name="StaticAndFallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <staticContent>
      <!-- 确保 .pigeon 能被作为下载/二进制返回 -->
      <mimeMap fileExtension=".pigeon" mimeType="application/octet-stream" />
    </staticContent>
  </system.webServer>
</configuration>
```

> `learn.html` / `admin.html` 是真实文件,会被第二条规则的 `IsFile` 命中而直接返回,不受兜底影响。

### 5.4 同源的好处

IIS 反代后,前端与 `/api` **同源**(同域名同端口)。此时:
- 浏览器对 `/api` 的请求自动带上同源 cookie,**无需 CORS 配置**(`CORS_ORIGINS` 可留默认或设为该域名)。
- 会话 cookie 在 HTTPS 下用 `Secure`(后端 `NODE_ENV=production` 已开启)最安全。

### 5.5 防火墙

- 对外只需放行 IIS 的 80/443。
- 后端 8787 **只监听/被本机 IIS 反代访问**,**不要**对公网开放 8787。

### 5.6 纯静态场景(不要后端)

若该服务器只想发前端:IIS 站点指向 `app\dist`,去掉 `ProxyApi` 规则即可,不装 NSSM/ARR。用户用本地访客档案,无跨设备同步。

---

## 六、前端 ↔ 后端对接（CORS / cookie / API 基址）

前端如何找到后端,见 `app/src/core/session.js` 的 `API_BASE`:

- **开发态**(`localhost:5173`)→ 自动指向 `http://localhost:8787/api`(跨源,需后端 CORS 放行 5173 + cookie `credentials`)。
- **生产同源**→ 走相对路径 `/api`(由反向代理转发到后端)。无跨域,最省心。
- **手动覆盖**:在页面上设 `window.PIGEONLIB_API = 'https://api.example.com/api'` 可强制指定后端基址(分离部署场景)。

分离部署(前端、后端不同域名)清单:
1. 后端 `.env` 的 `CORS_ORIGINS` 加上前端域名。
2. 前端设 `window.PIGEONLIB_API` 指向后端。
3. 后端 `NODE_ENV=production` + 全程 HTTPS(跨站 cookie 需要 `Secure`)。

---

## 七、排错

| 现象 | 排查 |
|---|---|
| 页面空白、控制台报 ES module / fetch 错误 | 用了 `file://` 打开。必须经 HTTP 源(`npm run dev` / 静态服务器 / IIS)。 |
| 首页内置课程 404、提示「未能加载」 | 构建前没打包课程。先 `node tools/build-pigeon.mjs ic-packaging` 再 `npm run build`。 |
| 登录后刷新就退出 / 跨设备不同步 | 后端没起,或 cookie 没带上。检查 `/api/health`;跨源时确认 CORS 放行了前端源且前端 `credentials:'include'`(已内置);生产跨站需 HTTPS + `Secure`。 |
| `npm install`(server)报原生编译错误 | 本方案用 `node:sqlite` + `bcryptjs`,**不应**有原生编译。若报错,基本是 Node 版本过低(需 ≥ 22.5)。`node -v` 确认。 |
| `node:sqlite` 报实验性警告 | 正常。后端启动脚本已用 `--disable-warning=ExperimentalWarning` 抑制。 |
| IIS 下 `/api` 502/404 | ARR 代理未开启,或 NSSM 服务没起。先确认 `http://127.0.0.1:8787/api/health` 本机可达,再查 `web.config` 反代规则。 |
| 管理面板进不去 | 需登录**管理员**账户。首个注册者即管理员;或用 `.env` 的 `SEED_ADMIN_*` 预置。 |
| 数据丢了 | 用户数据在浏览器本地(访客)或 `server/data/pglib.db`(账户)。备份后者。清浏览器存储会清掉访客档案。 |

---

> 后端契约与安全细节见 [`user-system-design.md`](./user-system-design.md) 与 [`../server/README.md`](../server/README.md)。
