# SN 分发管理插件

基于现有纯前端 iframe 插件体系。root 管理员搜索普通账号、批量生成 SN、查看和复制完整码、导出 CSV、停用或恢复 SN、编辑备注和查看操作记录。每个 SN 的账号与首次绑定设备保持固定；插件不提供解绑、换机、删除或修改所属账号。

本仓库只包含管理前端插件及相关文档。认证、设备绑定、数据库迁移和 Token 签发由 `xrugc-platform` 的平台主后端及其身份服务提供；本仓库不包含后端或 Unity/Rokid 客户端实现。

独立仓库：[7dgame-com/plugin-sn](https://github.com/7dgame-com/plugin-sn)。运行标识仍为
`sn-management`，超级项目以 `plugins/sn-management` 子模块引用。

```sh
git clone git@github.com:7dgame-com/plugin-sn.git
cd plugin-sn
```

## 接入文档

- [功能说明与管理员操作](docs/FEATURES_README.md)
- [Unity/Rokid 客户端接入说明](docs/UNITY_CLIENT_README.md)
- [主后端 API 与部署配置参考](docs/BACKEND_API_README.md)

## 本地开发

Node.js 24.x、pnpm 9.15.0。在本目录执行：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

默认端口 3018。复制 `.env.example` 为 `.env` 可配置 `APP_API_URL`，默认 `http://localhost:8081`。宿主登录、插件鉴权与 SN API 必须使用同一环境。主系统本地登记后通过 `/plugins/sn-management` 进入，直接访问插件会显示从主系统进入的提示。

插件使用 `PLUGIN_READY → INIT`，通过 `GET /api/v1/plugin/verify-token` 验证 root，处理 token 更新、会话销毁、主题语言切换及内部 URL 同步。token 只留在内存；销毁后迟到请求不能恢复会话。界面提供中文和英文；日语、泰语暂显示英文，繁体中文暂复用中文正文。

## API 与凭证处理

管理 API 使用 `/api/v1/plugin-sn`，去掉 `/api` 后转发主后端。管理 API 响应统一为 `{ success: true, data: ... }`；主会话校验沿用 `{ code: 0, data: ... }`。

设备字段沿用 `device_uuid: string | null`：生成时为空，首次激活后由主后端直接写入 `device_sn.device_uuid`，停用后仍保留。UUID 只在 SN 系统中唯一。旧 `device` 表继续保留，本功能不读写它，旧设备的账号归属也不影响 SN 激活；插件无需访问旧设备接口。

列表仅显示 SN 尾号，查看完整码与导出分别调用后端审计接口。完整码只在当前弹窗内保存，关闭或退出会话时清除。导出 CSV 对公式前缀和控制字符做转义。生成不自动重试；网络失败时提示先刷新列表核对是否已生成，避免重复发行。

## 构建与部署

```sh
corepack pnpm test
corepack pnpm build
docker build -t sn-management:local .
node scripts/test-container.mjs sn-management:local
```

容器只接受一个主后端 `APP_API_1_URL`（默认 `http://api:80`，可包含 `/api` 前缀）。配置 `APP_API_2_URL` 时直接拒绝启动，代理不会自动重试写请求或随机分流。`APP_RESOLVER` 默认 Docker DNS `127.0.0.11`。`/health` 返回插件健康状态，`/plugin-manifest.json` 提供自描述信息。

生产通过系统管理插件登记 `plugins.json.example`，将 URL 改为实际业务域名并保持 `accessScope: root-only`。本地 `developmentOnly` 登记不会注入生产。后端数据库迁移、账号限制、绑定事务、凭证加密、撤销会话和 Rokid 登录由主后端负责。

浏览器交互验收需要超级项目 `web` 的 Playwright 安装和正在运行的 3018 开发服务器：执行 `node scripts/test-browser.mjs`。脚本拦截全部业务 API，覆盖握手、root 门禁、生成/查看/复制/导出、停用恢复、备注审计、失败保留草稿、主题语言和窄屏、降权与销毁；截图写入 `/tmp/sn-management-desktop.png` 与 `/tmp/sn-management-mobile.png`。

## 分支与 CI

分支为 `develop`、`main`、`publish`，默认分支为 `main`。GitHub Actions 的
[CI 工作流](.github/workflows/ci.yml) 在三支的 push、pull request 及手动触发时运行：

1. Node.js 24 + pnpm 9.15.0，锁定依赖安装、单元测试、TypeScript 检查和 Vite 构建。
2. 构建 linux/amd64 Docker 镜像，运行独立容器的 Nginx/代理/健康接口检查。
3. 非 PR 运行将同一个已通过检查的镜像推送至腾讯云仓库；PR 只验证，不推送镜像。

镜像：`hkccr.ccs.tencentyun.com/plugins/plugin-sn`。

| 分支 | 发布标签 |
| --- | --- |
| `develop` | `develop`、`sha-<完整提交 SHA>` |
| `main` | `main`、`sha-<完整提交 SHA>` |
| `publish` | `publish`、`latest`、`sha-<完整提交 SHA>` |

沿用组织 Actions Secrets：`TENCENT_REGISTRY_USER`（也兼容 `TENCENT_REGISTRY_USERNAME`）
和 `TENCENT_REGISTRY_PASSWORD`。凭据不写入源码或镜像。
CI 负责验证和发布镜像，不直接更新 Portainer 或业务数据库。
后续平台功能发布按项目流程先验证 develop 和实际开发环境，再同时推进 main、publish。
