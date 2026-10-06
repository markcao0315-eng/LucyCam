# LucyCam

中文手机网页相机原型。所有图像处理在浏览器本地完成，不上传照片，不使用 AI 接口。

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

也可以用仓库的 `render.yaml` 创建 Blueprint。它默认创建一个 Free Web Service；手动 Web Service 与 Blueprint 二选一，避免重复创建。当前不需要数据库、磁盘或 AI API Key。

Render 自动设置 `PORT`；程序监听 `0.0.0.0`，运行版本由 `.node-version` 指定为 Node 24。

部署成功后打开 Render 实际返回的 HTTPS 网址。`/healthz` 应返回 `{"status":"ok"}`，`/api/status` 会明确返回 `aiComposition: false`。当前后台仅提供网页、健康检查和功能状态，尚未实现 AI 中转。

GitHub 私有仓库只控制源码访问；Render 的 Web Service 网址默认可公开访问，不继承旧 Sites 演示版的登录保护。当前没有服务端照片存储和收费 API。接入 AI 前需要实现访问控制和调用限额。

后续 API 密钥放在 Render 的 Environment 中，不写入前端代码或 GitHub。`.env` 和日志已在 Git 忽略规则中；`.env.example` 仅作配置说明。

官方文档：[Render Web Services](https://render.com/docs/web-services)、[Render Projects](https://render.com/docs/projects)。

## 功能

- 摄像头权限、前后镜头切换，自拍预览与保存均为镜像。
- 3:4 / 1:1 / 9:16 中心裁切；网格和构图参考不写入照片。
- 原片、清透、暖阳、胶片、黑白；可调滤镜浓度。
- 3 / 10 秒定时拍照，前后台切换时停止相机。
- 本地照片导入（保留原比例）、JPEG 导出、系统文件分享和下载。
- 主屏幕图标与安装清单。当前需要联网加载，不保证离线启动。

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

`npm run check` 检查语法；`npm test` 验证裁切、分辨率上限、像素滤镜、后台健康检查、静态资源和私有文件隔离。`npm start` 启动与 Render 相同的服务器，本地默认端口为 10000。

## 已验证与限制

- Chromium 模拟手机视口与摄像头验证：拍照、3:4/方形输出、滤镜切换、JPEG 下载、本地导入、倒计时、320px/390px 宽度、拒绝权限后的备用路径。
- WebMCP 的可选设置工具已在模拟 registry 下验证；未验证真实支持该接口的浏览器宿主。
- 尚未在真实 iPhone Safari 上验证。镜头切换、分享中的存储图像、HEIC 导入及实际画质需真机确认。
- 当前拍照来自相机视频流，尺寸以界面显示为准；不能代表 iPhone 原生相机最高静态画质。导入照片导出上限为 800 万像素且最长边 4096。
- 当前构图建议是固定场景参考。AI 场景理解、连续机位追踪、AI 滤镜推荐、美颜和精修尚未实现。
- 未接入商业账号、付款、用户图库、云存储或分析追踪。

`dist/` 是相机前端。`server.mjs` 提供 Render 服务，目前无第三方运行时依赖。`.openai/hosting.json` 保留旧 Sites 演示站标识，Render 不使用这个文件。本次迁移准备不会自动更新旧演示站。
