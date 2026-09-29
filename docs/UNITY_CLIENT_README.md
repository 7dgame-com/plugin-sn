# Rokid 设计指南与 Unity 开发交接

适用对象：在另一个开发上下文中接入 Rokid 客户端的 Unity 开发者。协议核对日期：2026-09-29。

**当前改造仅在本地实现，尚未部署开发或生产。** 网页 SN 管理继续使用主 API；
Unity 的激活、登录、刷新和退出统一使用 **y1（`backend/yii3-a1`）**。
y1 复用现有用户名密码登录的 HS256 Token 体系，不通过主 API 或 identity 签发设备会话。
主 API 的 `sn-activate/sn-login` 在本次版本返回 `410 Gone`，不能作为备用激活入口。

**本文件可以整体交给新的开发上下文，不需要此前聊天记录。** 第 1–5、7 节是服务端协议和
客户端必须满足的约束；第 6 节是请求参考；第 8–9 节是验收与推荐实现划分；第 10 节可直接
复制为开发任务。优先复用 Unity 工程现有网络层、Token 管理器、登录 UI 和业务模块。

**客户端只接受规范化后的 16 位 SN，不实现 32 位兼容。** 设备首次以管理员分发的
SN + 稳定设备 UUID 激活，以后启动或 Access Token 到期时继续用同一对凭据登录。
成功 Token 交回原 y1 登录管理器；后续 y1 业务请求使用原 Bearer 流程。
主 API 与 y1 共享既有 `device_sn` 表、账号和 UUID 绑定，不创建第二套授权表。
y1 只用 SN 摘要查询，不需要也不应接收主 API 的 AES 密钥。

2026-09-28 已完成的开发/生产验收属于此前“主 API + identity”版本，保留为历史证据，
不证明本次 y1 路由、HS256 会话或账号删除作废改动已部署。历史管理插件配置为
`admin-only`（admin + root）；实际管理权限仍由插件配置决定。SN 目标必须是启用且
没有 root/admin/manager 角色的普通账号，设备会话不能用来管理 SN 或派生普通登录凭据。

**Unity/Rokid 客户端尚未在本仓库实现或真机验收。** y1 完成部署并核验后，仍须联调真实
Rokid 启动、休眠唤醒、自动重登和自然到期；不能沿用旧服务端验收作为新协议已通过的证明。

- [功能说明与管理员操作](FEATURES_README.md)
- [主 API 管理接口与配置](BACKEND_API_README.md)
- y1 协议实现见平台仓库 `backend/yii3-a1/docs/device-sn.md`。
- 2026-09-28 历史发布记录见平台仓库 `docs/sn-management/DEVELOPMENT_DEPLOYMENT_20260927.md`。

## 1. 接入前准备

### 1.1 环境与地址

分别配置 `y1BaseUrl`（Unity 认证及原有 y1 业务）和管理端主 API 地址；不要混用。
以下 y1 地址沿用平台 `docs/unity-y1-qr-login-integration.md` 的既有配置；本轮尚未核验
运行版本或部署 SN 新接口，联调前须确认已更新。不要把主 API 域名当作 y1 备用入口。

| 环境 | Unity 认证根地址 | 管理员分发入口 |
|---|---|---|
| 开发 | `https://y1.d.xrteeth.com`（新接口部署待核验） | [开发主站 SN 管理](https://d.dev.xrugc.com/plugins/sn-management) |
| 生产 | `https://y1.xrteeth.com`（新接口部署待核验） | [生产主站 SN 管理](https://d.xrugc.com/plugins/sn-management) |

完整激活地址是 `y1BaseUrl.TrimEnd('/') + "/v1/auth/sn-activate"`。
根地址不要包含 `/v1`；仅在部署确有代理前缀时保留该前缀。不要把
`api.d.xrteeth.com`、`api.xrteeth.com` 等主 API 地址用作新设备认证入口。
收到旧主 API 的 `410` 应停止请求并修正配置，不能自动跳转或把凭据转发到响应提供的任意地址。

Unity 不使用管理插件 iframe 的 `PLUGIN_READY → INIT` 握手，不需要管理员 Token，
也不调用 `/v1/plugin-sn`。`port.*` 是运维控制台，管理插件 iframe URL 也不是 y1 API。

同环境 y1 节点必须使用相同权威 MySQL、Redis 逻辑库和 HS256 签名配置，部署后再验证跨端
登录与刷新。未完成核验前使用单个已确认入口，不自动故障转移，不因网络错误切换生产。
开发、生产凭据和会话必须隔离，也不能将网页主 API 的 Token 交给 y1 刷新或反向混用。

### 1.2 历史验收基线（不适用于本次 y1 改造）

| 环境 | 主后端提交 | identity 提交 |
|---|---|---|
| 开发 | `5db7de91bae78ce1b96528e782cf93a94c9692c3` | `a979ee328e00639cd8525920338e8790c9367aae` |
| 生产 | `00bf801a5a682a1fa78e12c6abf2828d2e211bb6` | `d1691ae66c9050acf0af834da0dd525440b18fc0` |

以上仅记录 2026-09-28 的主 API/identity 验收版本，不是 y1 版本或客户端允许运行的 SHA 白名单。
本次 y1 尚未发布，联调时记录实际 y1 镜像、提交、环境与接口结果；不能根据主 API 的
`/health` 判断 y1 已更新。第 4 节的到期时间说明按 y1 协议执行。

### 1.3 开发者需补齐的工程信息

1. Unity 工程位置、Unity 版本、Rokid 型号/系统、已集成 SDK 及正式签名方式。
2. 现有登录管理器、Token DTO、HTTP 层、账号信息加载入口、安全存储和生命周期管理方式。
3. 管理员为本次联调专门分发的 SN，绑定正常普通账号；双设备验收需要同账号两个 SN。
   之前发布验收的 SN 已停用留档，不可当作可复用测试凭据。完整码通过安全渠道交付，
   不放进聊天、代码、测试快照或文档；本文所有 SN 示例都只是格式占位。

缺少真机或测试 SN 时，可先完成接口适配、模拟服务测试和 UI；最终交付需明确列出尚未
真机验证的项目，不能把编辑器模拟结果当作上线验收。

生产使用 HTTPS，保持正常证书验证；认证请求不跟随重定向，把 3xx 当作入口配置问题处理。
真机访问开发机时须使用真机可达的开发地址，真机上的 `localhost` 指向真机自身。

## 2. SN 与 UUID 约定

| 项目 | 约定 |
|---|---|
| SN | 去掉 ASCII 空白和连字符并转大写后，长度严格为 16 位；字符集 `0123456789ABCDEFGHJKMNPQRSTVWXYZ` |
| SN 显示 | 4 组 × 4 位，含连字符共 19 个字符；不自动把 I/L/O 等转换为数字 |
| 请求长度 | 原始 SN 字符串最多 128 字节；UUID 原始字符串最多 255 字节 |
| UUID | 首尾去空白、统一小写；规范化后匹配 `[a-z0-9][a-z0-9._:-]{0,254}`，不要求 RFC 4122 格式 |
| 绑定关系 | 一 SN 对应一个账号和一个 UUID；同账号多设备各自使用不同 SN |
| 有效期 | SN 永久有效，管理员可停用；Access Token 有限期且最长 3 小时 |
| 设备登记 | 不需要提前注册设备；服务端首次激活直接写入 `device_sn.device_uuid`，不使用旧 `device` 表 |

客户端只接受规范化后恰好 16 位的 SN，拒绝其他长度（包括 32 位）；不能截断、补齐或
重新生成 SN。粘贴时先读取完整输入，再规范化并校验，不能靠输入框限制悄悄截成 16 位。
输入与读取本地凭据后都执行同一校验；本地已保存的非 16 位 SN 不参与自动激活/登录，
进入需要处理状态，提示联系管理员，不自动删除、截断或换绑。

UUID 的获取通过项目自己的 `IDeviceIdentityProvider` 一类适配层完成。优先使用经过真机
验证的 Rokid 平台稳定标识；这里没有指定或虚构某个 Rokid SDK 方法。
不要每次启动调用 `Guid.NewGuid()`，也不要在 UUID 获取失败时用空串、固定占位值或随机值激活。

如果考虑 `SystemInfo.deviceUniqueIdentifier`，先完成正式签名包的稳定性验证。
Unity 官方说明 Android 上该值来自 ANDROID_ID 的 MD5，Android 8 及以上的值会受到
应用签名密钥影响，调试包和发布包可能不同；不支持的平台可能返回
`SystemInfo.unsupportedIdentifier`。不能把它直接视为永久硬件序列号。
见 [Unity 设备标识说明](https://docs.unity3d.com/cn/6000.0/ScriptReference/SystemInfo-deviceUniqueIdentifier.html)。

验收应涵盖重启、覆盖升级、签名一致性、重装、清数据、恢复出厂等实际交付场景。
若读取到的 UUID 与本地曾使用的 UUID 不一致，停止自动认证并提示排查，不尝试换绑；
一期没有解绑/换机接口。UUID 是设备声明的标识，不提供硬件防克隆能力。

## 3. 接口

### 3.1 首次激活并登录

```http
POST /v1/auth/sn-activate
Content-Type: application/json
Accept: application/json

{
  "sn": "0000-1111-2222-3333",
  "uuid": "rokid-test-device-001"
}
```

示例 SN 只演示格式，必须替换为管理员实际生成的码。请求不需要用户名、密码或已有
Bearer Token，也不要提交 `user_id`、`auth_method` 或 `device_sn_id` 来选择账号。

后端原子绑定 UUID，再签发 Token。同一 SN + UUID 重复激活成功；同一码换 UUID、
同一 UUID 换另一码均被拒绝。停用 SN 仍占用原 UUID。

若绑定已提交，但签发失败、响应丢失或客户端退出，原绑定仍保留；使用原 SN + UUID
重试激活即可。不要因此替换 UUID 或申请另一个 SN 自动重试。

### 3.2 已激活设备登录

```http
POST /v1/auth/sn-login
Content-Type: application/json
Accept: application/json

{
  "sn": "0000-1111-2222-3333",
  "uuid": "rokid-test-device-001"
}
```

用于正常启动、Token 即将到期/已到期及从后台恢复后的续登录。
该接口不会隐式激活。未激活的 SN 返回 409。

### 3.3 成功响应与业务请求

激活和登录均为 HTTP 200：

```json
{
  "success": true,
  "message": "login",
  "nickname": "<账号昵称>",
  "user": {"id": 123, "username": "<账号名>", "nickname": "<账号昵称>", "fixture": false},
  "token": {
    "accessToken": "<JWT>",
    "expires": "2026-09-29 16:00:00",
    "refreshToken": "<refresh credential>"
  }
}
```

检查 HTTP 状态、`success` 和必需字段后，复用原 Token 管理器保存结果；允许响应包含
额外字段。`message` 不是业务状态码，不要依赖它控制流程。
`token` 是对象，不是字符串；读取 `accessToken/expires/refreshToken`，不要依赖 identity 的
`token.token/tokenType` 扩展。Access Token 是 y1 现有 HS256 JWT，携带 `uid` 及服务端维护的
`auth_method=device_sn/device_sn_id`；客户端不生成或覆盖来源字段。`expires` 是 Access Token
到期时间，不是剩余秒数或 Refresh Token 到期时间。不要把主 API/identity 的 EC Token 当作 y1 Token。

后续业务请求：

```http
GET /v1/server/private
Authorization: Bearer <accessToken>
Accept: application/json
```

这是 y1 已有的受保护业务路由示例；沿用项目实际使用的 y1 业务接口与账号加载流程，
不要假设主 API 的 `/v1/user/info` 也存在于 y1。客户端不从 SN 推导账号，也不根据自己
解析的 JWT 给用户增加权限。SN/UUID 不需要随每次业务请求上传；此 Token 不用于网页 SN 管理。

### 3.4 Refresh Token 兼容入口

```http
POST /v1/auth/refresh
Content-Type: application/json

{"refreshToken":"<refresh credential>"}
```

以上请求发送到 y1；`POST /v2/auth/refresh-token` 也支持同一 y1 Refresh Token，
两条刷新路径都保留并核验 SN 来源。成功结果均含 `success:true` 和 `token`；v1 的
`message` 为 `refresh`，v2 沿用现有 `keyToTokenWithUrl` 文案并包含 `user`。不要依据文案判断会话来源。
如原客户端已使用这些接口，
必须同时替换返回的 Access Token 和 Refresh Token，禁止并行轮换同一个 Refresh Token。
每次刷新都会检查 SN 授权，停用后无法刷新。

**本次 Rokid 的默认续登录方式是 SN + UUID，非依赖 Refresh Token。**
实现时选定一个自动续登录入口，避免刷新与 SN 重登两个循环同时运行。
若采用兼容刷新流程，网络超时后不要无限重放旧 Refresh Token；它可能已被消费，
可在统一认证任务中改用一次 SN + UUID 登录恢复。

### 3.5 退出当前 y1 会话

退出流程调用同一 y1 的 `POST /v1/auth/logout`，JSON 请求体为
`{"refreshToken":"<当前 refresh credential>"}`，不要求有效 Access Token，成功返回 `{success:true,message:"logout"}`。
它撤销对应刷新会话，不撤销永久 SN、不解除 UUID 绑定，也不承诺立即作废已签发 Access。
先让客户端进入退出状态并阻止迟到响应，再尝试撤销刷新会话；断网或撤销失败不能阻止本地退出。
以后重新使用 SN + UUID 仍能登录，除非管理员停用授权或账号。

## 4. Unity 登录状态与自动续登录

建议复用现有登录管理器，增加 SN 凭据入口，并维护以下状态：

### 4.1 状态和恢复流程

| 状态 | 行为 |
|---|---|
| 等待输入 | 没有保存的 SN，显示激活页 |
| 正在激活/登录 | 只有一个认证请求，其他业务请求等待它结束 |
| 已登录 | 把当前 Access Token 交给现有业务网络层 |
| 等待重试 | 仅对网络/暂时服务故障退避，保留同一对凭据 |
| 需要处理 | 输入错误、授权拒绝、绑定冲突或入口配置错误，停止自动循环 |

推荐实现顺序：

1. 读取稳定 UUID；读取按环境隔离保存的 SN、曾绑定 UUID、是否完成激活的本地标记。
2. 没有 SN 时让用户输入；提交前把候选 SN + UUID 安全保存为“待确认”，防止激活响应
   丢失后进程退出。保存失败就先提示处理，不声称已完成持久激活。
3. 待确认的凭据调用 `sn-activate`；已经成功激活的凭据在启动时调用 `sn-login`。
4. 成功后原子更新整个 Token 对象、激活标记和会话版本，唤醒等待认证的请求。
5. 按 JWT `exp` 安排续登录，可提前 60 秒；恢复到前台时重新检查，不只依赖后台计时器。
6. 用户退出、换 SN、切环境或销毁登录管理器时，取消认证/重试，并递增会话版本；
   旧请求迟到的响应不得重新写入登录态。需要删除本机凭据时执行明确的清除操作。

若只保存了 SN、丢失了本地激活标记，可直接以同一对凭据调用一次 `sn-activate` 恢复。
对正常登录返回的 409，也可进入一次同对激活恢复；恢复仍返回 409 时停止自动尝试。
这不允许换机，也不能据此把原 UUID 替换为新 UUID。

### 4.2 到期时间处理

- y1 返回 `yyyy-MM-dd HH:mm:ss`，按 `Asia/Shanghai` 解释；例如上面的 `expires`。
  不要把这个无时区字符串当成 UTC 或设备本地时区。主 API/identity 的 ISO 表示属于其他
  会话体系，不用它替代 y1 的协议约定。
- 统一读取 JWT payload 的数值 `exp`（Unix 秒）作为续登录排程依据；使用现有 JWT
  解析工具处理 Base64URL。解析 payload 仅用于排程，不等于验签或权限校验。
- 不要写死收到 Token 后恰好使用 3 小时。解析失败、设备时钟异常时避免高频登录循环，
  提示检查时间/协议；后端仍是鉴权的最终依据。

多个请求遇到过期时，共享同一个续登录任务。续登录成功后，仅按业务接口原有的重试约定
重试请求；对于写操作，未明确保证幂等时不得自动重放，尤其不能在网络超时后盲目重发。
业务 403 通常是权限不足，不触发重登。业务 401 可触发一次受控重登，但认证接口自身的
401 必须终止循环，不能递归调用自己。

### 4.3 并发与迟到响应

建议在原会话管理器里维护以下内存状态，名称可按工程习惯调整：

| 状态 | 用途 |
|---|---|
| `authEpoch` | 退出、清凭据、切环境时递增，使此前所有认证与业务响应失效 |
| `tokenVersion` | 每次成功替换整个 Token 对象时递增，识别旧 Token 请求迟到的 401 |
| `inFlightAuth` | 当前唯一认证任务；启动、到期、前台恢复和业务 401 都加入这个任务 |

认证开始时捕获环境、UUID 和 `authEpoch`；结束时不一致则丢弃结果。Token 替换与版本更新
作为一个提交动作，再释放等待队列。业务请求记录发出时的版本：收到旧版本的 401 时，
若已有更新的会话，只按原接口重试规则使用新 Token，不再启动第二次重登。
单个页面取消等待不应取消其他业务共享的认证；只有全局退出/切环境等动作取消整个任务。
一个业务请求最多因认证失败重放一次，再失败就返回上层处理。

### 4.4 休眠、唤醒与离线

- 登录服务的生命周期跟随应用，不随场景切换重复创建。按现有工程的协程、Task 或 UniTask
  实现，不为本功能强行引入新的异步框架。
- 合并 `OnApplicationPause` / `OnApplicationFocus` 引起的重复恢复事件，检查到期和设备
  标识后共用一次认证。应用在后台暂停计时并不延长 Token 有效期；到期后业务请求等待认证。
- 断网不删除 SN。恢复连接时退避重试；如果应用允许看本地缓存，显示离线状态。首次激活和
  获取新的 Token 都需要联网，不实现离线激活，不以本地伪造 Token 绕过服务端。
- “退出登录”结束本轮会话并停止自动重登；保留 SN 时，下次冷启动可按原要求自动登录。
  “清除本机激活信息”是另一个明确操作，只清本地。两者均不能解除服务器绑定。

## 5. 错误处理与重试

以 HTTP 状态为主。Yii 错误通常有 `message`，但网关可能返回非 JSON；错误体不使用成功
响应 DTO。当前未激活与冲突没有独立、稳定的业务错误码，不要匹配英文消息做分支。

| 情况 | 客户端行为 |
|---|---|
| 200 但缺少必需 Token 字段/无法解析 | 协议错误，不进入已登录状态，避免紧密重试 |
| 400 | SN/UUID 格式或请求不正确，提示修改输入 |
| 401（认证接口） | 凭据、授权、账号或身份服务校验失败；停止自动重试，保留安全保存的 SN 供排查；管理员确认授权恢复后才手动重试，账号删除导致的永久作废不能恢复 |
| 403 | 不自动重登；提示权限问题并核对入口 |
| 410 | 仍在请求旧主 API，停止自动重试并改为已核验的 y1 地址；不自动重定向凭据 |
| 404、405、3xx | 路径/方法/入口配置问题，核对部署与代理前缀 |
| 409 | 未激活、已绑定不同 UUID、同 UUID 被其他 SN 占用，或并发冲突；见下文 |
| 429 | 遵循 `Retry-After` 秒数，等待后重试同一请求；缺失时使用本地退避 |
| 5xx、连接中断、超时 | 按退避规则重试相同凭据；不假定服务端未完成绑定 |

y1 的 401 包含凭据无效、账号不可用、SN 停用或永久作废等情况，不能仅凭状态断言
“SN 一定被停用”。提示“设备授权无法使用，请联系管理员”，保留安全存储的凭据供处理。
503 按临时故障有限退避；不要绕到主 API/identity 或普通登录码入口尝试解除来源约束。

409 的安全处理：已知首次激活请求只允许原 SN + UUID 少量重试，以容忍并发锁冲突；
重复冲突即停止，显示“设备或激活码已有绑定，请联系管理员”。正常登录的 409 最多尝试
一次同对激活恢复；不要在登录和激活之间无限切换。

建议退避为 1、2、4、8、16、最大 30 秒，每次叠加随机抖动，且 429 不早于服务端指定时间。
建议每轮最多连续 5 次暂时故障重试，之后显示等待网络/手动重试；网络恢复或重新进入前台
时只唤起一个认证任务。等待应使用不受 `Time.timeScale` 影响的计时方式，用户退出后取消。

服务端代码的默认限制为每 IP 600 次/分钟、每 SN 和每 UUID 各 30 次/分钟；部署可调整，
不是客户端应依赖的固定额度。客户端不应
按这个上限持续轮询。不要给每个业务请求各建一个认证重试循环。

## 6. C# 请求示例

下例是传输层参考，使用 UnityWebRequest 协程与 JsonUtility；调用前必须按第 2 节完成
16 位 SN 与 UUID 校验。它不包含平台 UUID 获取、安全存储、JWT 排程或上一节的重试状态机，
也没有在 Rokid Unity 工程中编译/运行，
接入时按项目 Unity 版本及既有网络层调整。不要另建一套业务 HTTP 客户端。

```csharp
using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

[Serializable]
public sealed class SnLoginRequest
{
    public string sn;
    public string uuid;
}

[Serializable]
public sealed class SnToken
{
    public string accessToken;
    public string expires;
    public string refreshToken;
}

[Serializable]
public sealed class SnLoginReply
{
    public bool success;
    public string message;
    public SnToken token;
}

public sealed class SnAuthResult
{
    public long httpStatus;
    public bool connectionError;
    public string retryAfter;
    public SnLoginReply reply; // 仅完整成功响应有值；其余按状态表处理
}

public static class SnAuthTransport
{
    public static IEnumerator Send(
        string y1BaseUrl, string sn, string uuid, bool activate,
        Action<SnAuthResult> completed)
    {
        // y1BaseUrl 来自已核验的 y1 环境配置；不能填网页主 API 地址。
        string path = activate ? "/v1/auth/sn-activate" : "/v1/auth/sn-login";
        string json = JsonUtility.ToJson(new SnLoginRequest { sn = sn, uuid = uuid });
        byte[] body = Encoding.UTF8.GetBytes(json);

        using (var request = new UnityWebRequest(y1BaseUrl.TrimEnd('/') + path, "POST"))
        {
            request.uploadHandler = new UploadHandlerRaw(body);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.timeout = 15;
            request.redirectLimit = 0;
            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader("Accept", "application/json");
            // 此认证入口不附带旧 Bearer Token。
            yield return request.SendWebRequest();

            var result = new SnAuthResult
            {
                httpStatus = request.responseCode,
                connectionError = request.result == UnityWebRequest.Result.ConnectionError,
                retryAfter = request.GetResponseHeader("Retry-After")
            };

            if (request.result == UnityWebRequest.Result.Success && request.responseCode == 200)
            {
                result.reply = ParseSuccess(request.downloadHandler.text);
            }
            // 不记录 json、响应体、SN 或 Token。调用方还需检查会话版本，丢弃迟到响应。
            completed(result);
        }
    }

    private static SnLoginReply ParseSuccess(string json)
    {
        try
        {
            var value = JsonUtility.FromJson<SnLoginReply>(json);
            if (value != null && value.success && value.token != null
                && !string.IsNullOrEmpty(value.token.accessToken)
                && !string.IsNullOrEmpty(value.token.refreshToken)
                && !string.IsNullOrEmpty(value.token.expires))
                return value;
        }
        catch (ArgumentException) { }
        return null;
    }
}
```

通过 `StartCoroutine(SnAuthTransport.Send(...))` 调用，回调中 `reply != null` 才视为协议成功。
交给原 Token 管理器前仍需检查本轮会话版本及到期排程数据。
取消时由认证管理器中止当前请求/协程，并阻止旧回调覆盖新会话。

网络接口参考：[上传处理器](https://docs.unity3d.com/6000.0/Documentation/Manual/web-request-creating-upload-handlers.html)、
[请求超时](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Networking.UnityWebRequest-timeout.html)、
[重定向限制](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Networking.UnityWebRequest-redirectLimit.html)。

## 7. 本地保存与退出

- SN 是长期登录凭据。通过项目已有的安全存储适配层保存，按 API 环境隔离；记录激活
  时的 UUID 用于变化检测，不能靠伪造旧 UUID 来绕过实际设备标识变化。
- 不把 SN/Token 写入场景、Prefab、ScriptableObject、明文配置、日志、遥测或版本库。
  Unity 官方说明 PlayerPrefs 不加密，不能用于保存敏感凭据。
  见 [PlayerPrefs](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/PlayerPrefs.html)。
- Android 可由原生安全存储适配层使用 Keystore 管理加密密钥、加密保存凭据；Keystore
  本身管理密钥，不是把任意 SN 字符串直接写入的通用键值库。
  见 [Android Keystore](https://developer.android.com/privacy-and-security/keystore)。
- 默认只在内存维护 Access/Refresh Token，应用重启后用 SN + UUID 获取新 Token。
  如果原项目必须持久保存 Token，沿用其安全存储和完整替换机制。
- 普通网络故障和授权失败不自动清除 SN；明确的“清除本机激活信息”操作才清理本地
  凭据、当前 Token 并取消重试。清除本机信息不会解绑服务器 UUID，也不允许此 SN 换机。
- 管理员停用阻止新登录和刷新，已签发 Access Token 最长仍可用 3 小时；不能承诺即时
  踢下线。账号停用/升级管理角色时，SN 会话也会受到限制。
- 新增规则（需后端增量迁移与发布）：删除绑定账号将全部所属 SN 永久作废，
  y1 后续 Access 鉴权、激活、登录和刷新均拒绝；同名或同 ID 重建账号也不能恢复。
  客户端不能从通用 401 判断一定永久作废，也不能循环重试或承诺管理员可恢复。
  此项目前仅本地实现，尚未部署；账号临时停用与 SN 停用仍按可恢复流程处理。

## 8. Unity 联调验收清单

使用测试账号和独立测试 SN；不要用生产设备做冲突或重装实验。

- [ ] 首次输入 SN 激活成功，`/v1/user/info` 返回预期普通账号。
- [ ] 16 位 SN 可输入、保存、激活及重登；分组/无分组、大小写和 ASCII 空白输入按约定处理；其他长度（包括 32 位）在发送前被拒绝，不截断输入或本地凭据。
- [ ] 杀进程重启后无需手输 SN，使用同 UUID 登录；覆盖升级后 UUID 不变。
- [ ] 同账号两台设备使用两个 SN，均能进入同一账号的业务数据。
- [ ] 同 SN 不同 UUID、同 UUID 不同 SN 均拒绝，客户端不会自动改 UUID。
- [ ] 同 SN + UUID 重复激活成功；模拟响应丢失后原凭据可恢复。
- [ ] 到期/即将到期时自动 SN 重登；并发业务请求只产生一个认证任务。
- [ ] 场景切换、后台休眠、唤醒和多个恢复回调不会重复创建认证服务；旧请求迟到的 401 不触发额外重登。
- [ ] 401、409、429、5xx、非 JSON 响应、断网、超时均按规则处理，没有无限重登。
- [ ] y1 两条刷新路径均保留 SN 来源；主 API 的旧激活/登录返回410，不产生绑定或Token。
- [ ] 停用后新登录和刷新失败，另一设备不受影响；恢复后原 UUID 能登录。
- [ ] 在支持新规则的环境删除专用测试账号后，所属 SN 永久失效，客户端停止认证重试；账号重建不能恢复旧码。
- [ ] 账号禁用或升级管理员后拒绝 SN 会话；不尝试用二维码/OIDC 换出其他登录凭据。
- [ ] 清除本机信息、切环境、销毁登录管理器后，迟到响应不能恢复旧会话。
- [ ] 主动退出后本轮不自动登录；开发/生产凭据隔离；安全存储失败时不宣称激活记录已保存。
- [ ] 正式签名、目标 Rokid 型号上的 UUID 获取与凭据安全存储经过验证。
- [ ] 检查日志和崩溃报告，SN/Access Token/Refresh Token 未被输出。

验收记录填写 Unity 版本、Rokid 型号/系统、安装包版本及签名标识、API 环境和后端版本，
只记录 SN 尾号，不记录完整凭据。

建议分三层交付验证：

| 层次 | 必须覆盖的内容 | 证据边界 |
|---|---|---|
| 编辑器自动化 | 用假 HTTP、假时钟和内存凭据库测试规范化、错误分类、退避、并发、旧响应隔离、退出与环境隔离 | 不能证明 Rokid UUID 或 Android 安全存储可用 |
| 开发环境真机 | 正式签名包、真实 UUID、首次激活、重启、覆盖升级、双设备、断网/唤醒、自动续登录及原有业务流程 | 使用专用测试账号/SN，冲突测试不要占用正式设备 |
| 长时间运行 | 观察实际到期自动登录；记录到期前后身份和业务连续性 | 假时钟或测试 Token 只能补充，不能写成已自然运行 3 小时 |

自动化过期测试在客户端注入时钟/模拟服务，不改生产 Token 有效期、不提取签名密钥。
无需准备历史 32 位测试凭据，也不实现其兼容或迁移。使用无效长度的假输入验证客户端
会在发送前拒绝即可；真机联调只使用管理员分发的有效 16 位 SN，不自行拼造有效凭据。

## 9. 推荐实现划分与产品行为

以下是职责建议，具体类名、目录、异步方式按现有 Unity 工程整合，不要求照搬或重建框架。

| 职责 | 输入/输出和边界 |
|---|---|
| 设备标识适配层，例如 `IDeviceIdentityProvider` | 从已确认的 Rokid/Android 能力取得真实稳定标识，输出合法 UUID 或明确不可用原因；不能随机降级 |
| 凭据存储，例如 `ISnCredentialStore` | 原子读取/保存按环境隔离的 SN、曾绑定 UUID 和激活标记；通过现有安全存储实现 |
| 认证传输，例如 `SnAuthTransport` | 使用现有 HTTP 层发送 activate/login，返回状态、Retry-After 和解析结果；认证请求绕过 Bearer 注入和自动 401 重试拦截器 |
| 原登录管理器中的 SN 策略 | 负责首次激活、启动登录、到期排程、唯一在途任务、有限退避、取消和会话版本；将成功 Token 交回原管理器 |
| 原业务请求层 | 继续使用 Bearer；记录会话版本、等待统一认证、按接口幂等约定处理一次认证重试 |
| 原激活/登录 UI | 输入 SN、显示进度与可操作的错误；成功后复用既有账号加载和进入业务场景流程 |

若同一工程还保留用户名密码入口，只为 SN 会话选择这套续登录策略；普通密码会话沿用原流程。
服务端 JWT 中的 `auth_method=device_sn`、`device_sn_id` 用于来源限制，客户端不用自行提交
或改写。不要为 SN 会话申请二维码登录凭据、OIDC 凭据或调用 identity 内部签发接口。

推荐持久记录包含 `schemaVersion`、`environmentKey`、`sn`、`boundUuid`、
`activationState`（`Pending` / `Active`）。这是客户端自己的安全存储结构，不是 API 请求体。
`environmentKey` 使用固定的开发/生产标识；同一已确认环境的 A/B 不应生成两套设备绑定。
保存候选记录前保留已有记录以便明确处理失败，避免半写入的 SN 与 UUID 被拼成错误配对。

Rokid 界面至少包含以下行为：

| 页面/状态 | 面向设备用户的行为 |
|---|---|
| 首次输入 | 支持 16 位 SN 的粘贴和分组显示，其他长度提示错误；不要求输入用户名、密码、账号 ID 或 UUID |
| 认证中 | 防止连点提交，显示正在连接；返回/退出可取消当前流程 |
| 连接失败 | 显示正在重试或手动重试，保留输入；到达重试上限后停止循环 |
| 授权或绑定异常 | 显示联系管理员/重试入口和 SN 尾号；不宣称能换机，不将所有 401 都写成“码已停用” |
| 已登录 | 进入原有业务页面；如需要设备信息页，仅展示账号、环境、SN 尾号与必要的设备诊断信息 |

不显示或记录完整 Token；日志仅记录环境、请求类型、HTTP 状态、重试次数和脱敏诊断信息。
完整 SN 只在输入与受控存储过程中使用。若 SDK 暂时无法提供可靠 UUID，应在适配层返回明确
失败并完成其余工程工作，列出需要确认的 SDK/设备信息，不能悄悄用占位值占用真实 SN。

## 10. 可直接复制给另一个上下文的开发任务

把本文件随以下任务一起交给能访问目标 Unity 工程的开发上下文；不必附带生产运维记录、
后台密钥、管理员 Token 或完整 SN。

```text
请在当前 Unity/Rokid 工程中实现 SN 激活与免密登录，依据随附的
《Rokid 设计指南与 Unity 开发交接》，协议核对日期 2026-09-29；本次 y1 服务端改造尚未部署。

先检查工程说明、Unity/SDK 版本、现有设备 UUID 获取、登录管理器、Token DTO、
HTTP/401 处理、安全存储、生命周期和原业务入口，再沿用这些设施接入。
Unity 认证、刷新、退出及原业务使用本环境已核验的 y1BaseUrl；根地址不含 /v1。
既有开发 y1 地址 https://y1.d.xrteeth.com，生产 https://y1.xrteeth.com；
本次 SN 新接口尚未部署，联调前核验环境版本，不使用网页主 API 地址。
网页 SN 管理继续在主 API。不要更改部署配置或管理插件权限；旧主 API 激活/登录返回410。

已确定：
1. SN 只支持规范化后恰好 16 位，不兼容 32 位。输入与本地凭据均先校验，
   不截断、补齐或自动换绑。首次提交稳定 UUID + SN 到
   POST /v1/auth/sn-activate；以后启动和 Access Token 到期使用
   POST /v1/auth/sn-login。请求 JSON 只有 sn、uuid，不需要旧 Bearer。
2. 返回 success/message/token，其中 token 为含 accessToken、expires、
   refreshToken 的对象，复用 y1 用户名密码登录的 HS256 Token 管理器及原 y1 Bearer 请求。
   /v1/auth/refresh 与 /v2/auth/refresh-token 均保留 SN 来源；/v1/auth/logout 撤销刷新凭据。
   不与主 API/identity 的网页 Token 混用，不调用 identity 内部签发接口。
   默认续登录用 SN + UUID；不要再并行运行 Refresh Token 自动刷新循环。
3. 一个 SN 对一个 UUID；同账号多设备分别用不同 SN。无换机/解绑接口。
   同对激活可安全重试，UUID 变化必须停下处理，不自动改 UUID 或生成假值。
4. 原子安全保存环境、SN、曾绑定 UUID 和 Pending/Active 标记；支持响应丢失恢复。
   认证单飞、有限退避、Retry-After、取消和会话版本隔离；退出后迟到响应不得恢复会话。
   409 不能判定可换绑；认证 401 停止自动循环；业务写请求不能盲目重放。
5. 管理端当前 admin + root 可分发；设备只能登录正常普通账号，不能管理 SN 或换出
   二维码/OIDC 等脱离 SN 约束的凭据。仅停用 SN 后，旧 Access 可用至到期，最长 3 小时。
   支持账号删除作废的后端会永久拒绝被删除账号的 SN，不能把这类授权失败提示为可恢复。

先完成可以独立实现的工程修改和有意义的自动化测试。UUID SDK 选择依据真实项目，
不要虚构 Rokid API；缺少真机、签名或有效测试 SN 时列出准确需求，继续完成其余工作。
只用专门分发的开发 SN 联调；不要写入代码、日志、聊天或测试快照。
附文档 C# 片段只是传输参考，尚未在此 Unity 工程编译；请按工程实际整合并验证。

交付：工程改动、简短接入 README、开发/生产配置方式、测试结果和剩余真机验收项。
覆盖首次激活、同对恢复、启动登录、到期登录、并发 401、休眠唤醒、断网、
退出/切环境、16 位格式校验及其他长度拒绝、安全存储，以及原用户名密码/业务流程回归。
不要把模拟结果描述为真机验证，也不要擅自发布生产安装包。
```
