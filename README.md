# SN 分发管理插件

基于现有纯前端 iframe 插件体系。获得插件访问权限的账号可以搜索普通账号、批量生成 SN、查看和复制完整码、导出 CSV、停用或恢复 SN、编辑备注和查看操作记录。默认访问范围为 `root-only`，root 可在系统管理的插件配置中调整。每个 SN 的账号与首次绑定设备保持固定；插件不提供解绑、换机、删除或修改所属账号。

本仓库只包含管理前端插件及相关文档。网页管理、SN 生成和数据库迁移由 `xrugc-platform` 的主 API 提供；Unity/Rokid 的 SN 激活、登录、刷新和退出由 `backend/yii3-a1`（y1）提供，复用 y1 原有 HS256 Token 体系。本仓库不包含后端或 Unity/Rokid 客户端实现。

**2026-09-29 的 y1 认证迁移和账号删除永久作废改动仅在本地实现，尚未部署开发或生产。** 本次版本中主 API 的 `sn-activate/sn-login` 返回 `410 Gone`；客户端须按环境改连 y1。此前发布记录不能证明本次改造已上线。

独立仓库：[7dgame-com/plugin-sn](https://github.com/7dgame-com/plugin-sn)。运行标识仍为
`sn-management`，超级项目以 `plugins/sn-management` 子模块引用。

```sh
git clone git@github.com:7dgame-com/plugin-sn.git
cd plugin-sn
```

## 接入文档

- [功能说明与管理员操作](docs/FEATURES_README.md)
- [Rokid 设计指南与 Unity 开发交接（含可复制的开发任务）](docs/UNITY_CLIENT_README.md)
- [主 API 管理与 y1 认证部署参考](docs/BACKEND_API_README.md)

## 本地开发

Node.js 24.x、pnpm 9.15.0。在本目录执行：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

默认端口 3018。复制 `.env.example` 为 `.env` 可配置 `APP_API_URL`，默认 `http://localhost:8081`。宿主登录、插件鉴权与 SN 管理 API 必须使用同一环境的主 API；不要将插件上游改为 y1。Unity 单独配置同环境 y1 地址。主系统本地登记后通过 `/plugins/sn-management` 进入，直接访问插件会显示从主系统进入的提示。

插件使用 `PLUGIN_READY → INIT`，先通过 `GET /api/v1/plugin/verify-token` 验证身份，再请求 `GET /api/v1/plugin-sn/access` 获取后端确认的管理权限。插件不根据 INIT 配置或本地角色推断授权；每个管理 API 都由主后端按当前插件配置重新检查。token 只留在内存；销毁、重新验证或权限撤销后，旧请求不能恢复会话或显示完整码。界面提供中文和英文；日语、泰语暂显示英文，繁体中文暂复用中文正文。

## 动态访问范围

root 在 **系统管理 → 插件注册管理 → sn-management → 访问范围** 中修改 `access_scope`：

| 配置 | 可以管理 SN 的普通登录会话 |
| --- | --- |
| `root-only`（默认） | root |
| `admin-only` | admin、root |
| `manager-only` | manager、admin、root |
| `auth-only` | user、manager、admin、root |

注册示例保留 `root-only` 默认值；截至 2026-09-28，本轮开发、生产实际已配置并核实 `admin-only`（admin + root）。root 可在同一配置入口改回 `root-only`。后续实际生效状态以对应环境配置及验收记录为准。

例如改为 `admin-only` 后，admin 可以进入并分发 SN；改回 `root-only` 后，其下一次管理请求会被后端拒绝。已打开页面收到 403 会关闭列表、详情及完整码弹窗并清除本地 token，显示权限变更提示，不自动重试；重新授权后可手动重新验证。主站菜单配置可能需要刷新页面才更新，但后端不依赖菜单缓存授权。

运行中若策略配置读取失败，后端返回 `503` 和 `error_code: PLUGIN_ACCESS_CONFIG_UNAVAILABLE`，前端同样清空会话、关闭敏感页面并使在途旧响应失效，提示稍后重试。普通业务 503 不带这个专用错误码，不会撤销管理会话，也不会自动重试写请求。

SN 设备登录产生的会话始终没有 SN 管理权限，包括 `auth-only`。被绑定账号仍必须是正常启用、没有 root/admin/manager 角色的普通账号。插件未登记或被禁用时拒绝访问；缺失/非法 scope 或配置服务不可用时显示验证失败，不回退到默认授权。此功能需要配套主后端能力接口与动态权限实现，文档更新不表示已部署。

本轮 SN 动态权限要求插件登记为公共插件（`organization_name IS NULL`）。私有组织配置不在本次支持范围，组织值非 NULL 时即使 root 也不放行。

## API 与凭证处理

管理 API 使用 `/api/v1/plugin-sn`，去掉 `/api` 后转发主后端。管理 API 响应统一为 `{ success: true, data: ... }`；主会话校验沿用 `{ code: 0, data: ... }`。

设备字段沿用 `device_uuid: string | null`：生成时为空，首次激活时由 y1 直接写入与主 API 共享的 `device_sn.device_uuid`，停用后仍保留。迁移认证入口不新增表，不复制或重建绑定。UUID 只在 SN 系统中唯一。旧 `device` 表继续保留，本功能不读写它，旧设备的账号归属也不影响 SN 激活；插件无需访问旧设备接口。

新生成 SN 为 16 位 Crockford Base32，显示为 4 组 × 4 位，含连字符共 19 个字符。y1 设备接口和 Unity 客户端仅接受规范化后的 16 位，不兼容 32 位登录。主 API 仍能保存、查看和导出历史 32 位码用于留档；插件按服务端原值展示，不截断旧码。管理 API 字段保持不变，实际环境规则以部署版本为准。

列表仅显示 SN 尾号，查看完整码与导出分别调用后端审计接口。完整码只在当前弹窗内保存，关闭或退出会话时清除。导出 CSV 对公式前缀和控制字符做转义。生成不自动重试；网络失败时提示先刷新列表核对是否已生成，避免重复发行。

新增“已作废”状态：删除绑定账号后，SN 永久失效，显示原账号 ID 并取消停用/恢复入口，仍保留详情、备注与导出。需要主后端执行 `m260928_150000_preserve_revoked_device_sn` 并升级；本项当前仅本地实现，尚未部署。

## 构建与部署

```sh
corepack pnpm test
corepack pnpm build
docker build -t sn-management:local .
node scripts/test-container.mjs sn-management:local
```

容器只接受一个主后端 `APP_API_1_URL`（默认 `http://api:80`，可包含 `/api` 前缀）。配置 `APP_API_2_URL` 时直接拒绝启动，代理不会自动重试写请求或随机分流。`APP_RESOLVER` 默认 Docker DNS `127.0.0.11`。`/health` 返回插件健康状态，`/plugin-manifest.json` 提供自描述信息。

生产通过系统管理插件登记 `plugins.json.example`，将 URL 改为实际业务域名，初始采用 `accessScope: root-only`，之后由 root 按需修改访问范围。先部署 system-admin 的只读配置接口，再配置主 API 的 `PLUGIN_ACCESS_CONFIG_BASE_URL` 并升级动态授权及 `/v1/plugin-sn/access`，最后部署本插件，详见 [后端接入要求](docs/BACKEND_API_README.md)。仅修改前端登记不能替代后端授权。本地 `developmentOnly` 登记不会注入生产。

主 API 负责凭证加密、管理授权和共享表迁移；y1 负责设备绑定、账号资格检查及设备会话签发、刷新和撤销。两侧必须使用同一权威 `device_sn`、账号和角色数据；y1 各节点共享 Redis 刷新状态、限流状态和 HS256 `JWT_KEY`。y1 不调用 identity 签发，也不需要主 API 的 AES keyring。Unity 的旧主 API 会话需用原 SN + UUID 向 y1 重新登录，不能跨服务混用 Token。

浏览器交互验收需要超级项目 `web` 的 Playwright 安装和正在运行的 3018 开发服务器：执行 `node scripts/test-browser.mjs`。脚本拦截全部业务 API，覆盖握手、动态授权、生成/查看/复制/导出、停用恢复、备注审计、失败保留草稿、主题语言和窄屏、admin 授权与收回、伪造 INIT 不放行、SN 会话拒绝及销毁；截图写入 `/tmp/sn-management-desktop.png` 与 `/tmp/sn-management-mobile.png`。

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
