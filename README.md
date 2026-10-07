# LucyCam

中文手机网页相机。普通拍照与滤镜在浏览器本地完成；点击「AI 构图」时，仅将当前画面缩小后经 Render 中转给 Google Gemini，返回构图建议和裁切预览。

演示网址：https://lucycam.onrender.com

代码仓库：https://github.com/markcao0315-eng/LucyCam

## GitHub 与 Render 部署

仓库根目录就是本地 `lucycam-web` 目录。GitHub 顶层应直接看到 `package.json`、`server.mjs` 和 `render.yaml`。

1. 在 Render 创建 `LucyCam` Project，环境使用 `Production`。
2. 添加 **Web Service**，连接 GitHub，选择 `markcao0315-eng/LucyCam` 私有仓库。只授权此仓库即可。
3. 按下面的配置部署：

| 字段 | 值 |
| --- | --- |
| Name | `lucycam`（已被占用时加后缀） |
| Language / Runtime | `Node` |
| Branch | `main` |
| Root Directory | 留空 |
| Build Command | `npm ci && npm run check && npm test` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Environment variable | `NODE_ENV=production` |
| Instance | 初次连通测试选 Free；实际使用可换常驻付费实例 |

也可以用仓库的 `render.yaml` 创建 Blueprint。它默认创建一个 Free Web Service；手动 Web Service 与 Blueprint 二选一，避免重复创建。当前不需要数据库或持久磁盘。未配置 AI 时，普通拍照仍可使用。

Render 自动设置 `PORT`；程序监听 `0.0.0.0`，运行版本由 `.node-version` 指定为 Node 24。

部署成功后打开 Render 实际返回的 HTTPS 网址。`/healthz` 应返回 `{"status":"ok"}`，`/api/status` 显示版本 `0.3.1`。`aiComposition: true` 仅表示配置齐全，不代表已经验证 Google Key 的有效性。

GitHub 私有仓库只控制源码访问；Render 的 Web Service 网址默认可公开访问。相机页面可公开使用，收费 AI 接口要求家庭访问口令。

API 密钥放在 Render 的 Environment 中，不写入前端代码、聊天或 GitHub。`.env` 和日志已在 Git 忽略规则中；`.env.example` 仅作配置说明。

## 配置 AI

在现有 Render Web Service → Environment 中添加并保存部署：

| 变量 | 值 |
| --- | --- |
| `GEMINI_API_KEY` | 你自己的 Google Gemini API Key |
| `LUCYCAM_ACCESS_CODE` | 自己设置的至少 12 位私人口令，手机上输入这个口令 |
| `GEMINI_MODEL` | 可选，默认 `gemini-3.1-flash-lite` |
| `AI_DAILY_LIMIT` | 可选，默认每 UTC 日 200 次尝试 |
| `AI_HOURLY_LIMIT` | 可选，默认每 UTC 小时 60 次尝试 |

手机刷新页面，开启相机，点击「AI 构图」，输入家庭口令解锁，再点击一次开始分析。绿色框表示 AI 建议保留的范围；点「预览这张裁切照片」，再保存到相册。裁切使用手机内存中的较高分辨率原帧，上传的只是最长边 1024 像素的 JPEG。滤镜在导出时本地应用，AI 读取的是无滤镜画面。

如果按钮显示 AI 未配置，检查两个必填变量和口令长度，再确认最新部署成功。若出现 Google 服务错误，检查 Key、Gemini API 权限、所选模型和项目额度。配置变量后仍需在手机实际点击一次验证；自动测试不使用真实 Key，也不产生 AI 费用。

口令验证后使用 12 小时 HttpOnly / SameSite=Strict 会话，生产环境增加 Secure；修改口令会使旧会话失效。POST 请求限制为同源 JSON；默认只允许单个分析并发、每 5 秒一次，登录每 15 分钟最多 30 次尝试。调用上限为**单进程内存计数**，重启会重置，多实例各自计数，不是账单硬上限；失败的模型请求也计入次数，无自动付费重试。当前面向单实例家庭使用。

LucyCam 不把照片存入文件、数据库或应用日志，但 Google 会按其服务条款处理上传图片；个人照片建议确认 Google 项目的计费和数据使用设置。[Gemini API 定价与数据使用说明](https://ai.google.dev/gemini-api/docs/pricing)。

官方文档：[Render Web Services](https://render.com/docs/web-services)、[Render Projects](https://render.com/docs/projects)。

## 功能

- 摄像头权限、前后镜头切换，自拍预览与保存均为镜像。
- 3:4 / 1:1 / 9:16 中心裁切；网格和构图参考不写入照片。
- 原片、清透、暖阳、胶片、黑白；可调滤镜浓度。
- 3 / 10 秒定时拍照，前后台切换时停止相机。
- 本地照片导入（保留原比例）、JPEG 导出、系统文件分享和下载。
- 主屏幕图标与安装清单。当前需要联网加载，不保证离线启动。
- 单帧 AI 主体描述、中文构图建议、保持原比例的裁切预览与照片导出；访问口令、调用限额、错误提示。

## iPhone 演示

1. 用 Safari 打开部署后的 HTTPS 网址。旧 Sites 演示版是私有的；新 Render 部署不要求 ChatGPT 登录。
2. 点击「开启相机」，允许摄像头权限。
3. 选择色彩和场景，调整取景，按白色快门。
4. 点「保存 / 分享」，选择「存储图像」。若没有这一项，长按预览图保存。
5. 打开 iPhone「照片」确认保存成功；分享完成不等于已保存。
6. 可从 Safari 分享菜单选择「添加到主屏幕」。不需要 Apple Developer、Xcode 或 TestFlight。

照片只暂存于页面内存，刷新或关闭前应保存。「下载图片」可能进入「文件」而非「照片」。权限被拒绝时，调整 Safari 的网站相机权限后重试。微信等应用内浏览器不作为当前测试目标。

## 开发

Node.js 运行 `npm run dev`，本机打开 http://127.0.0.1:4173 。iPhone 不能把这台电脑的 localhost 当成演示地址，也不要使用不支持相机权限的普通局域网 HTTP 地址。手机请使用正式 HTTPS 网站。

`npm run check` 检查语法；`npm test` 验证裁切、分辨率上限、像素滤镜、后台健康检查、静态资源、私有文件隔离、AI 会话/限额/超时/返回值校验。AI 单测注入模拟 provider，无外部 AI 请求。`npm start` 启动与 Render 相同的服务器，本地默认端口为 10000。本地调试时通过 shell 环境变量传入配置，程序不会自动读取 `.env`。

## 已验证与限制

- Chromium 模拟手机视口与摄像头验证：拍照、3:4/方形输出、滤镜切换、JPEG 下载、本地导入、倒计时、320px/390px 宽度、拒绝权限后的备用路径。
- WebMCP 的可选设置工具已在模拟 registry 下验证；未验证真实支持该接口的浏览器宿主。
- 尚未在真实 iPhone Safari 上验证。镜头切换、分享中的存储图像、HEIC 导入及实际画质需真机确认。
- AI 浏览器流程已用 Chromium 模拟相机与模拟 Gemini 返回验证：错误/正确口令、单次上传、建议展示、裁切尺寸、JPEG 下载、会话保持、320px 排版。真实模型建议质量与真实 iPhone 体验仍需配置 Key 后验证。
- 当前拍照来自相机视频流，尺寸以界面显示为准；不能代表 iPhone 原生相机最高静态画质。导入照片导出上限为 800 万像素且最长边 4096。
- 绿色裁切框叠加在点击时的静态参考画面上，不能跟随手机移动。连续机位追踪、目标点对齐后自动变焦、AI 滤镜推荐、美颜和精修尚未实现。数字裁切也不能替代原生镜头的光学变焦。
- 未接入商业账号、付款、用户图库、云存储或分析追踪。

`dist/` 是相机前端。`server.mjs` 提供 Render 服务，`ai.mjs` 处理会话和 Gemini 中转，目前无第三方运行时依赖。`.openai/hosting.json` 保留旧 Sites 演示站标识，Render 不使用这个文件，GitHub 推送不更新旧演示站。
