# SN 管理主 API 与 y1 设备认证

本文件为平台协议随附参考，核对日期为 2026-09-29。主 API 管理与迁移文档位于
`xrugc-platform/server/docs/device-sn.md`，设备认证文档位于
`xrugc-platform/backend/yii3-a1/docs/device-sn.md`。网页管理和 SN 生成保留在主 API；
Unity/Rokid 的 SN 激活、登录、刷新和退出由 y1 原生提供，复用其现有 HS256 Token 体系。
本插件仓库不包含后端或 Unity/Rokid 客户端实现。

**本次 y1 迁移及账号删除永久作废改动仅在本地实现，尚未部署开发或生产。**
此前主 API + identity 的发布记录属于历史版本，不能作为本次改造上线的依据。

- [插件功能说明](FEATURES_README.md)
- [Unity/Rokid 客户端接入](UNITY_CLIENT_README.md)
- [插件开发与部署](../README.md)

## 行为

符合插件当前访问范围的普通登录会话，通过 `sn-management` 插件选择已有普通账号，一次生成 1–100 个永久 SN；初始访问范围为 `root-only`。
每个 SN 只属于一个账号，首次激活只绑定一个 UUID；同账号可绑定多台设备。
管理端可以停用/恢复及修改备注，不能解绑、换机、改账号或直接删除 SN。
删除绑定用户账号会使其全部 SN 永久作废，保留记录、原账号 ID、设备 UUID 和已有审计；
作废后不能恢复，重新创建同名或同 ID 账号也不能复活原 SN。账号暂时停用不触发永久作废。
仅 `status=10` 且无 `root/admin/manager` 角色的账号可以使用设备会话。

设备 UUID 直接存入 `device_sn.device_uuid`，该字段可为空并具有唯一约束。生成 SN 时为空，
首次激活时由 y1 在事务内写入；同一 SN+UUID 重复激活幂等，其他 SN 不能占用该 UUID。
主 API 与 y1 共享同一权威库，迁移认证入口不新增表、不复制绑定。
停用不会清空 UUID，恢复仍只允许原设备登录。UUID 唯一性只限于 SN 系统：旧 `device` 表
继续保留，但本功能不读写它，也不使用旧设备的 `owner_id` 或 `active` 判定归属及授权。
因此，UUID 仅在旧设备表中存在或归属其他账号，不构成 SN 激活冲突。

UUID 支持 1–255 个 ASCII 字母、数字、点、下划线、冒号、连字符，
首字符必须为字母或数字；去除首尾空白并统一小写。Rokid 应从稳定的设备标识 API
读取 UUID，不能每次启动随机生成。它是客户端声明的标识，不构成硬件防克隆证明。

新生成 SN 为 16 位随机 Crockford Base32 字符，80 bit 熵，每 4 位分组；显示为
`0000-1111-2222-3333` 这样的 4 组格式，含连字符共 19 个字符（示例不是有效凭据）。
输入忽略大小写、ASCII 空白、连字符；y1 和 Unity 只接受规范化后的 16 位码，
不自动猜测 `I/L/O/U` 等字符。主 API 保存、查看和导出仍保留历史 32 位码及其
8 组显示格式用于留档，不截断、不补齐；这不表示新设备接口接受 32 位登录。
数据库保存 SHA-256 查询摘要及 AES-256-GCM 密文，完整 SN 只在受授权的生成、查看、
导出响应中出现。审计复用 `audit_log`，resource 为 `device_sn/{id}`，不记录完整 SN。

## Rokid 接入

以下认证路径属于 y1。客户端配置同环境的 `y1BaseUrl`，生产使用 HTTPS；
管理插件仍通过 `/api/v1/plugin-sn` 代理连接主 API，不将插件上游改为 y1。
既有 y1 地址为开发 `https://y1.d.xrteeth.com`、生产 `https://y1.xrteeth.com`，
本次 SN 新接口的运行版本尚待部署核验，不能仅根据域名可访问判断已经就绪。

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

两者成功均复用 y1 登录协议：

```json
{
  "success": true,
  "message": "login",
  "nickname": "<账号昵称>",
  "user": {"id": 123, "username": "<账号名>", "nickname": "<账号昵称>", "fixture": false},
  "token": {
    "accessToken": "<y1 HS256 JWT>",
    "expires": "2026-09-29 16:00:00",
    "refreshToken": "<y1 刷新凭据>"
  }
}
```

`expires` 沿用 y1 的 Asia/Shanghai `yyyy-MM-dd HH:mm:ss` 格式。后续 y1 业务调用继续
使用 `Authorization: Bearer <accessToken>`；账号 ID 和内容权限仍由原系统决定。
设备 JWT 和 Redis 刷新记录均保留 `auth_method=device_sn`、`device_sn_id`，不包含完整 SN。

客户端可使用 y1 的 `POST /v1/auth/refresh` 或严格入口 `POST /v2/auth/refresh-token`，
两者均轮换刷新凭据并重新检查 SN 来源；Rokid 默认策略仍为启动/到期时以 UUID+SN 重登。
`POST /v1/auth/logout` 撤销指定 y1 Refresh Token，保留 SN 和 UUID 绑定。
主 API/identity 的旧 Token 不与 y1 混用，切换入口时用原 SN + UUID 重新登录即可，无需重建绑定。
不要在 URL、遥测、崩溃报告或截图中暴露 SN/Token；SN 存入平台安全存储，退出设备授权时
清除本机凭据。不要在业务请求失败后无限重复登录。

主 API 的 `POST /v1/auth/sn-activate` 和 `POST /v1/auth/sn-login` 在本次版本返回
`410 Gone`，不代理或重定向凭据；客户端须使用已核验的 y1 地址，不能将其作为备用入口。
主 API 的普通网页登录协议与历史 SN 会话刷新来源检查保留。

- 400：输入格式不正确，提示用户检查 SN/UUID。
- 401：SN 停用、账号失效或授权无效；停止自动重试并提示联系管理员。
- 409：需要首次激活或已有冲突绑定；未激活设备走激活入口，冲突不得自动换绑。
- 410：误用了旧主 API 认证入口；停止请求并修正环境配置，不按响应猜测跳转域名。
- 429：遵循 `Retry-After`。
- 5xx/网络异常：1、2、4、8、16、最多 30 秒指数退避并加入随机抖动。

同一 SN+UUID 重复激活幂等；激活提交后即使签发失败或响应丢失，仍可用相同凭据重试。
停用提交后开始的新登录和刷新都拒绝；已通过授权检查的在途请求可能完成，既有
Access Token 最多继续 3 小时。恢复只恢复原绑定。账号删除会永久作废全部所属 SN，
后续 y1 激活、登录、刷新及 Access 鉴权均拒绝，主 API 历史 SN 会话也检查作废状态；
已通过校验的在途请求可能完成。
账号暂时停用或升为管理员时拒绝 SN 会话，但不将 SN 标记为永久作废。SN 会话不允许生成二维码登录码、OIDC 换票或修改账号密码/邮箱。

## 管理 API

所有 `/v1/plugin-sn` 接口均验证 Bearer Token，返回 `Cache-Control: no-store`。管理业务接口要求正常启用的用户，并由主后端逐请求读取可信插件配置判断权限：`root-only` 允许 root；`admin-only` 允许 admin/root；`manager-only` 允许 manager/admin/root；`auth-only` 允许 user/manager/admin/root。SN 设备登录来源的 Token 始终不能管理 SN。

root 可在系统管理的插件配置中修改 `sn-management.access_scope`。插件未登记或禁用时拒绝管理；缺失/非法 scope 或配置读取不可用时返回 503，不回退到默认授权。授权收回后下一次业务请求返回 403，前端清空 token 并卸载敏感页面，不自动刷新 Token 或重试请求。后端不接受 INIT 或请求正文提供的访问范围作为授权依据。

策略配置不可用的 503 保留 Yii 标准错误字段，并额外返回 `error_code:"PLUGIN_ACCESS_CONFIG_UNAVAILABLE"`。前端只将这一明确错误码的 503 视为授权无法确认：清空 token、卸载敏感界面、废弃旧请求代次，拒绝迟到的成功响应。普通业务 503 不撤销授权；两者都不自动重试写请求。

注册默认 root-only；本次用户要求最终线上采用 admin-only（admin + root），并保留通过同一插件配置改回 root-only 的能力。部署及验收应核对实际保存值，不能仅凭注册示例判断线上范围。
列表和详情只返回尾号，不返回摘要、密文、密钥或明文 SN。
列表、详情、生成与导出中的设备字段仍为 `device_uuid`：未激活时为 `null`，激活后为
规范化 UUID，停用或作废后保持原值。删除账号后 `user_id/username/nickname` 为 `null`，
`original_user_id` 保留原账号 ID，`enabled=false`、`status=revoked`，
`revocation_reason=account_deleted`；其他状态的 `revocation_reason` 为 `null`。
`original_user_id` 仅用于展示和历史筛选，绝不能作为认证绑定。

| 方法和路径 | 输入/结果 |
|---|---|
| GET `/v1/plugin-sn/access` | 已认证会话的当前管理能力：`{success:true,data:{allowed:boolean,access_scope:"root-only"\|"admin-only"\|"manager-only"\|"auth-only"\|null}}`；无权限时仍返回 200 和 `allowed:false`，不返回任何 SN 数据 |
| GET `/v1/plugin-sn/accounts` | `q,page,page_size`；仅返回可绑定账号 `id,username,nickname` |
| GET `/v1/plugin-sn` | `q` 搜索尾号/账号/UUID；`status=pending/active/disabled/revoked`、`user_id`、分页 |
| GET `/v1/plugin-sn/{id}` | 脱敏详情及最近 100 条操作审计 |
| POST `/v1/plugin-sn/generate` | `{user_id,count:1..100,remark}`；201，`data.items` 含本批完整 `sn` |
| PATCH `/v1/plugin-sn/{id}` | 只接受 `{enabled?:boolean,remark?:string}`，备注最多 500 字；已作废 SN 只可改备注，提交 `enabled` 返回 409 |
| POST `/v1/plugin-sn/{id}/reveal` | `data:{id,sn}`，记录查看审计 |
| POST `/v1/plugin-sn/export` | `{ids:[整数]}`，最多 100 条，`data.items` 含完整码并逐条审计 |

分页响应是 `{success:true,data:{items,total,page,page_size}}`，默认每页 20，最大 100。
其他管理响应是 `{success:true,data:...}`；错误使用 Yii 标准 HTTP 状态及 `message`。
SN 时间字段采用 UTC 数据库时间。`user_id` 筛选也匹配已删除账号的 `original_user_id`；
删除账号后不保留用户名快照，因此账号名搜索不能找回已删除账号的 SN。
作废记录仍允许查看详情、完整码、导出及改备注，用于留档；凭据不再能登录。

iframe 先调用原 `GET /v1/plugin/verify-token` 确认用户身份，再调用 `/v1/plugin-sn/access`。缺失或无效认证返回 401；配置读取异常返回 503。插件不存在、禁用或属于私有组织时返回 `allowed:false,access_scope:null`；设备 SN 来源会话也返回同样的拒绝能力。能力结果用于界面显示，不能替代每个业务 API 的实时授权。普通绑定账号条件不随管理范围放宽。

## 配置、迁移和双后端

1. 在主库执行 Yii migration `m260926_210000_create_device_sn_table`。前置条件为已有
   `user/audit_log/auth_item/auth_item_child` 表及 root 角色，不依赖旧 `device` 表。
   迁移创建包含 nullable unique `device_uuid` 的 `device_sn`，同时登记管理路由。
   接着执行增量迁移 `m260928_150000_preserve_revoked_device_sn`：新增并回填
   `original_user_id`，将 `user_id` 改为可空、外键改为 `ON DELETE SET NULL`。
   仍只使用原 `device_sn` 表；账号删除与作废由数据库原子完成，覆盖各删除入口。
2. 为主 API 配置 `DEVICE_SN_ACTIVE_KEY_ID` 与 `DEVICE_SN_KEYS`。后者是 key ID 到 base64 编码
   32-byte AES key 的 JSON。用 `openssl rand -base64 32` 生成随机密钥，通过部署 secret
   注入，例如 `{"v1":"<base64 key>"}`；不要提交真实值。更换 active key 后保留旧 key
   供历史 SN 解密。缺少密钥时生成/查看/导出失败，不退化成明文保存。
3. 主 API 的 `deviceSnDb` 使用同环境主库 MYSQL_* 与标准 Yii Connection，关闭副本读，
   不使用 CynosDB 逐语句重试。y1 的 `MYSQL_HOST/MYSQL_DB/MYSQL_USER/MYSQL_PASS`
   必须连接同一权威写库，共享现有账号、角色、SN 和审计表；独立库/异步副本不满足要求。
4. y1 原生使用现有 HS256 `JWT_KEY`，不依赖 identity 内部签发接口、开关或主 API 的 AES
   keyring。各 y1 节点签名配置必须一致。主 API/identity 的网页和历史 SN 会话配置保留，
   包括已有来源字段及同一权威库的 `LEGACY_DB_*`；这不恢复主 API 的设备登录入口。
   主 API 的 EC Token 与 y1 的 HS256 Token 不可混用。
5. y1 各节点的 `REDIS_HOST/REDIS_PORT/REDIS_DB` 指向同环境权威 Redis 逻辑库，
   共享刷新会话及限流状态。限流默认每 IP 600 次/分钟，每 SN 摘要和每 UUID 摘要各
   30 次/分钟；Redis 故障拒绝设备认证。使用与原主 API 相同的限流 key 和原子算法。
6. 插件仍固定到主 API，Rokid 改用已核验的 y1 入口。插件生产 Nginx 只接受一个
   `APP_API_1_URL`，不要填写 y1 或随机双后端模板。各 y1 节点一致性未证明前不自动
   故障切换。业务入口不是 Portainer 管理入口。
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

此前 16 位生成和 32 位历史码留档已有发布记录；本次 y1 设备认证只接受 16 位，部署前
应核对客户端凭据，不能截断历史码使用。认证迁移复用现有摘要和绑定，不需要新表或重绑；
账号删除永久作废仍须完成下面的增量迁移。目标环境是否已就绪必须按实际镜像和本轮验收核实。
回滚应先关闭插件和设备登录入口、停止 SN 发行，再部署兼容版本；已有 SN 后不要
直接执行破坏性 `safeDown`。数据库和加密
keyring 应配套备份，丢失旧 key 会导致历史 SN 无法再次查看，但摘要验证仍可用。

### 账号删除永久作废的升级要求

本项为本地实现，尚未发布到开发或生产环境；此前发布记录不代表该增量迁移已执行。
升级期间暂停所有账号删除入口及 SN 生成，备份数据库，在同一权威库执行
`m260928_150000_preserve_revoked_device_sn`，随后升级全部主 API 和参与设备认证的 y1 节点，
再升级插件并恢复操作。
暂停删除避免旧外键仍执行级联删除；暂停生成避免旧后端在回填后生成缺少原账号 ID 的记录。
只需对双后端共享的权威库迁移一次，不新建表，不依赖旧 `device` 表。

`user_id=NULL` 是不可恢复的作废状态；UUID 唯一占用继续保留，不能发新码给同 UUID 换绑。
已被旧 `CASCADE` 规则删除的历史 SN 无法通过此迁移补回。迁移不提供破坏性回退；回滚应用
时也须保留 nullable 外键与作废记录，并使用支持作废状态的兼容版本。

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
再验证主 API 管理生成→y1 激活→重登→两种刷新→退出→单码停用，以及另一个设备和
y1 密码登录不受影响；主 API 两个旧 SN 认证入口必须返回 410。y1 的测试入口见平台仓库
`backend/yii3-a1/docs/device-sn.md`，主 API 历史会话兼容仍须单独回归。
删除专用测试账号后确认全部 SN 显示已作废，激活、登录、刷新、旧 Access 和恢复均拒绝；
重建同 ID 账号也不能复活，回滚删除不影响 SN，原 UUID 不能被其他 SN 占用。
双后端必须额外验证 A 激活/B 登录、A 停用/B 拒绝刷新、并发绑定及失败切换。
