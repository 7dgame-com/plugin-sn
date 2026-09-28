# SN 分发与 Rokid 登录

本文件是平台主后端协议的随附参考，核对日期为 2026-09-28。源文档位于
`xrugc-platform/server/docs/device-sn.md`。认证、绑定、数据库迁移和 Token 签发由平台主后端
及其身份服务提供；本插件仓库不包含后端或 Unity/Rokid 客户端实现。

- [插件功能说明](FEATURES_README.md)
- [Unity/Rokid 客户端接入](UNITY_CLIENT_README.md)
- [插件开发与部署](../README.md)

## 行为

符合插件当前访问范围的普通登录会话，通过 `sn-management` 插件选择已有普通账号，一次生成 1–100 个永久 SN；初始访问范围为 `root-only`。
每个 SN 只属于一个账号，首次激活只绑定一个 UUID；同账号可绑定多台设备。
管理端可以停用/恢复及修改备注，不能解绑、换机、改账号或直接删除 SN。
仅 `status=10` 且无 `root/admin/manager` 角色的账号可以使用设备会话。

设备 UUID 直接存入 `device_sn.device_uuid`，该字段可为空并具有唯一约束。生成 SN 时为空，
首次激活时在事务内写入；同一 SN+UUID 重复激活幂等，其他 SN 不能占用该 UUID。
停用不会清空 UUID，恢复仍只允许原设备登录。UUID 唯一性只限于 SN 系统：旧 `device` 表
继续保留，但本功能不读写它，也不使用旧设备的 `owner_id` 或 `active` 判定归属及授权。
因此，UUID 仅在旧设备表中存在或归属其他账号，不构成 SN 激活冲突。

UUID 支持 1–255 个 ASCII 字母、数字、点、下划线、冒号、连字符，
首字符必须为字母或数字；去除首尾空白并统一小写。Rokid 应从稳定的设备标识 API
读取 UUID，不能每次启动随机生成。它是客户端声明的标识，不构成硬件防克隆证明。

新生成 SN 为 16 位随机 Crockford Base32 字符，80 bit 熵，每 4 位分组；显示为
`0000-1111-2222-3333` 这样的 4 组格式，含连字符共 19 个字符（示例不是有效凭据）。
输入忽略大小写、ASCII 空白、连字符；规范化后严格接受 16 位新码或 32 位历史码，
不接受其他长度，不自动猜测 `I/L/O/U` 等字符。历史 32 位码保留 160 bit 熵及原有
8 组显示格式，不截断、不补齐、不重新发行；其账号、UUID 和授权状态保持不变。
数据库保存 SHA-256 查询摘要及 AES-256-GCM 密文，完整 SN 只在受授权的生成、查看、
导出响应中出现。审计复用 `audit_log`，resource 为 `device_sn/{id}`，不记录完整 SN。

## Rokid 接入

主后端原生路径是 `/v1/...`；经主站/插件代理时一般是 `/api/v1/...`。
客户端配置环境的同一个权威 API base URL，生产使用 HTTPS。

首次输入 SN：

```http
POST /v1/auth/sn-activate
Content-Type: application/json

{"sn":"分发得到的 SN","uuid":"稳定的设备 UUID"}
```

之后每次启动或 Access Token 到期：

```http
POST /v1/auth/sn-login
Content-Type: application/json

{"sn":"本机保存的 SN","uuid":"同一个设备 UUID"}
```

两者成功均返回原登录协议：

```json
{
  "success": true,
  "message": "login",
  "token": {
    "accessToken": "JWT",
    "expires": "沿用当前 issuer 的时间格式",
    "refreshToken": "原有格式的刷新凭据"
  }
}
```

后续业务调用继续使用 `Authorization: Bearer <accessToken>`；账号 ID、角色及内容权限
仍由原系统决定。客户端可以继续使用 `/v1/auth/refresh`，但 Rokid 的默认策略为
启动/到期时以 UUID+SN 重登。不要在 URL、遥测、崩溃报告或截图中暴露 SN/Token；
SN 存入平台安全存储，退出设备授权时清除本机凭据。不要在业务请求失败后无限重复登录。

- 400：输入格式不正确，提示用户检查 SN/UUID。
- 401：SN 停用、账号失效或授权无效；停止自动重试并提示联系管理员。
- 409：需要首次激活或已有冲突绑定；未激活设备走激活入口，冲突不得自动换绑。
- 429：遵循 `Retry-After`。
- 5xx/网络异常：1、2、4、8、16、最多 30 秒指数退避并加入随机抖动。

同一 SN+UUID 重复激活幂等；激活提交后即使签发失败或响应丢失，仍可用相同凭据重试。
停用提交后开始的新登录和刷新都拒绝；已通过授权检查的在途请求可能完成，既有
Access Token 最多继续 3 小时。恢复只恢复原绑定。账号删除、停用或升为管理员会拒绝
该账号的 SN 会话。SN 会话不允许生成二维码登录码、OIDC 换票或修改账号密码/邮箱。

## 管理 API

所有 `/v1/plugin-sn` 接口均验证 Bearer Token，返回 `Cache-Control: no-store`。管理业务接口要求正常启用的用户，并由主后端逐请求读取可信插件配置判断权限：`root-only` 允许 root；`admin-only` 允许 admin/root；`manager-only` 允许 manager/admin/root；`auth-only` 允许 user/manager/admin/root。SN 设备登录来源的 Token 始终不能管理 SN。

root 可在系统管理的插件配置中修改 `sn-management.access_scope`。插件未登记或禁用时拒绝管理；缺失/非法 scope 或配置读取不可用时返回 503，不回退到默认授权。授权收回后下一次业务请求返回 403，前端清空 token 并卸载敏感页面，不自动刷新 Token 或重试请求。后端不接受 INIT 或请求正文提供的访问范围作为授权依据。

策略配置不可用的 503 保留 Yii 标准错误字段，并额外返回 `error_code:"PLUGIN_ACCESS_CONFIG_UNAVAILABLE"`。前端只将这一明确错误码的 503 视为授权无法确认：清空 token、卸载敏感界面、废弃旧请求代次，拒绝迟到的成功响应。普通业务 503 不撤销授权；两者都不自动重试写请求。

注册默认 root-only；本次用户要求最终线上采用 admin-only（admin + root），并保留通过同一插件配置改回 root-only 的能力。部署及验收应核对实际保存值，不能仅凭注册示例判断线上范围。
列表和详情只返回尾号，不返回摘要、密文、密钥或明文 SN。
列表、详情、生成与导出中的设备字段仍为 `device_uuid`：未激活时为 `null`，激活后为
规范化 UUID，停用后保持原值。后端存储调整不改变插件的 API 字段或 TypeScript 类型。

| 方法和路径 | 输入/结果 |
|---|---|
| GET `/v1/plugin-sn/access` | 已认证会话的当前管理能力：`{success:true,data:{allowed:boolean,access_scope:"root-only"\|"admin-only"\|"manager-only"\|"auth-only"\|null}}`；无权限时仍返回 200 和 `allowed:false`，不返回任何 SN 数据 |
| GET `/v1/plugin-sn/accounts` | `q,page,page_size`；仅返回可绑定账号 `id,username,nickname` |
| GET `/v1/plugin-sn` | `q` 搜索尾号/账号/UUID；`status=pending/active/disabled`、`user_id`、分页 |
| GET `/v1/plugin-sn/{id}` | 脱敏详情及最近 100 条操作审计 |
| POST `/v1/plugin-sn/generate` | `{user_id,count:1..100,remark}`；201，`data.items` 含本批完整 `sn` |
| PATCH `/v1/plugin-sn/{id}` | 只接受 `{enabled?:boolean,remark?:string}`，备注最多 500 字 |
| POST `/v1/plugin-sn/{id}/reveal` | `data:{id,sn}`，记录查看审计 |
| POST `/v1/plugin-sn/export` | `{ids:[整数]}`，最多 100 条，`data.items` 含完整码并逐条审计 |

分页响应是 `{success:true,data:{items,total,page,page_size}}`，默认每页 20，最大 100。
其他管理响应是 `{success:true,data:...}`；错误使用 Yii 标准 HTTP 状态及 `message`。
SN 时间字段采用 UTC 数据库时间。账号删除时其 SN 级联撤销，既有审计保留。

iframe 先调用原 `GET /v1/plugin/verify-token` 确认用户身份，再调用 `/v1/plugin-sn/access`。缺失或无效认证返回 401；配置读取异常返回 503。插件不存在、禁用或属于私有组织时返回 `allowed:false,access_scope:null`；设备 SN 来源会话也返回同样的拒绝能力。能力结果用于界面显示，不能替代每个业务 API 的实时授权。普通绑定账号条件不随管理范围放宽。

## 配置、迁移和双后端

1. 在主库执行 Yii migration `m260926_210000_create_device_sn_table`。前置条件为已有
   `user/audit_log/auth_item/auth_item_child` 表及 root 角色，不依赖旧 `device` 表。
   迁移创建包含 nullable unique `device_uuid` 的 `device_sn`，同时登记管理路由。
2. 配置 `DEVICE_SN_ACTIVE_KEY_ID` 与 `DEVICE_SN_KEYS`。后者是 key ID 到 base64 编码
   32-byte AES key 的 JSON。用 `openssl rand -base64 32` 生成随机密钥，通过部署 secret
   注入，例如 `{"v1":"<base64 key>"}`；不要提交真实值。更换 active key 后保留旧 key
   供历史 SN 解密。缺少密钥时生成/查看/导出失败，不退化成明文保存。
3. `deviceSnDb` 使用与本环境主库相同的 MYSQL_* 配置及标准 Yii Connection；关闭副本读，
   不使用 CynosDB 的逐语句重试。两个业务后端、identity 的 LEGACY_DB_* 必须指向同一
   权威写库，JWT 验签配置和 keyring 必须一致；独立库/异步复制不满足此约束。
4. 若 `AUTH_PROVIDER=identity`，先执行 identity session 增量迁移并升级签发服务，详见
   平台仓库 `xrugc-platform/services/identity-service/docs/runbooks/device-sn-sessions.md`。确认其
   `/internal/auth/device-sn/readiness` 三项均 true。旧 issuer 丢弃来源时主后端拒绝发证，
   SN 失败不会回退成普通会话。普通密码会话仍按原配置运行。
5. Redis 原子限流组件 `deviceSnRateLimiter` 默认每 IP 600 次/分钟、每 SN 摘要和每 UUID
   摘要各 30 次/分钟；Redis 故障拒绝请求。双后端应共享限流状态。
6. 未证明双侧一致性前，插件和 Rokid 固定到同一个权威业务入口。插件生产 Nginx 只接受
   一个 `APP_API_1_URL`；不能用随机双后端模板。业务入口不是 Portainer 管理入口。
7. 动态权限先部署 system-admin 的严格只读 `GET /api/v1/plugin/access-config/:id`，
   再在两侧主 API 配置非 secret 环境变量 `PLUGIN_ACCESS_CONFIG_BASE_URL`，指向同环境
   可信配置服务，例如开发 Docker 网络的 `http://system-admin-d:8088`、生产 Docker 网络的
   `http://system-admin-p:8088`；这些是部署配置示例，必须核对目标服务名与连通性。
   主 API 先验证真实身份、角色和 SN 来源，再逐请求读取固定配置路径；不转发用户 Token、
   Cookie、Host 或角色。配置源只返回 `organization_name IS NULL` 的公共插件元数据，
   不回调主 API 验证 Bearer，避免两服务相互等待。不存在、禁用或组织非 NULL（包括空白）
   返回 404，私有组织插件本轮不支持，root 也不能绕过。成功响应要求 `code:0` 和 `data` 内
   的 `policy_version:1`、匹配插件 ID、`enabled:true`、合法 scope；非法配置/数据库异常为 503。
   reader 不跟随重定向、不使用环境代理，连接超时 1 秒、总超时 5 秒、响应上限 16 KiB。
   双侧配置服务须读取同一环境的权威插件配置库，配置响应不包含插件 URL 或组织名。
   配置 reader 不复制数据库凭据、不新增表。升级主 API 并确认能力接口正常后再部署前端；
   本节描述接入要求，不表示该配置链路已经部署。

开发环境已有此前 32 位版本的迁移与测试数据；本次 16 位生成规则是否已部署，须按
目标环境实际镜像和验收记录核实。长度调整复用现有摘要、密文和尾号字段，不需要
新增迁移或回填历史 SN，也不涉及旧 `device` 表和普通登录数据。先升级所有会接收
SN 的后端至兼容 16/32 位的版本，再分发新码；已签发 16 位码后不能回滚到只接受
32 位的版本。
回滚应先关闭插件和设备登录入口、停止 SN 发行，再部署兼容版本；已有 SN 后不要
直接执行破坏性 `safeDown`。数据库和加密
keyring 应配套备份，丢失旧 key 会导致历史 SN 无法再次查看，但摘要验证仍可用。

## 验证

以下命令在平台仓库 `xrugc-platform/server` 目录执行，依赖平台后端的测试工具和脚本；
这些文件不包含在本插件仓库中。插件自身的验证命令见 [插件 README](../README.md)。

```sh
cd advanced
php vendor/bin/phpunit --do-not-cache-result -c phpunit.xml --filter DeviceSn
# 仅一次性测试 MySQL，脚本会创建并删除随机命名的 codex_device_sn_php_* 测试库：
DEVICE_SN_MYSQL_TEST_PORT=13318 php tests/integration/device_sn_mysql.php
# 同时验证真实 Redis/JWT 与密码登录（Redis 也必须是一次性测试容器）：
DEVICE_SN_MYSQL_TEST_PORT=13318 DEVICE_SN_REDIS_TEST_PORT=16318 php tests/integration/device_sn_mysql.php
```

上线验收记录应包含环境、镜像/提交、迁移及 key ID（不含 key 内容）、测试用例和结果。
验证 root 默认可用、admin 在 root-only 下被拒绝、改为 admin-only 后可管理、改回后已有 admin 页面及 API 被拒绝；SN 来源 Token 即便在 auth-only 下也不获得管理权限。配置读取失败须拒绝访问。
再验证 SN 生成→Rokid 激活→重登→刷新→单码停用，以及另一个设备和密码登录不受影响。
双后端必须额外验证 A 激活/B 登录、A 停用/B 拒绝刷新、并发绑定及失败切换。
