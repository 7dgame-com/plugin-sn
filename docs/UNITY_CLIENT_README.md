# Unity / Rokid 端 SN 激活与免密登录接入

适用对象：实现 Rokid 客户端的 Unity 开发者。协议核对日期：2026-09-27。

本独立仓库提供 SN 管理前端插件及接入文档。认证、绑定、数据库迁移和 Token 签发由
`xrugc-platform` 的平台主后端及其身份服务提供；本仓库不包含后端或 Unity/Rokid 客户端实现。

设备首次输入管理员分发的 SN，以 **SN + 稳定设备 UUID** 激活；以后启动或 Access Token
到期时，继续用同一对凭据登录。成功后把 Token 交给原来的登录态和业务请求模块，
业务 API 仍使用 Bearer Token，不需要增加另一套账号、权限或业务接口。

SN 管理端默认仅 root 可用，root 可通过插件配置授权 admin 等角色；此配置只调整管理端使用者。SN 绑定目标仍是普通账号，设备 SN 登录产生的 Token 始终不能调用 SN 管理接口，即使管理插件配置为 `auth-only`。Unity 仅接入下面的激活、登录和原有业务接口。

本文是待接入 Unity 工程的实现说明和请求示例；当前仓库没有完成 Rokid 客户端工程接入。
后端代码及本地测试已完成，实际联调入口、部署版本和测试 SN 由项目负责人提供。
本次协议改为新生成 16 位 SN，并兼容历史 32 位码；接入前须确认目标后端已部署这一版本。

- [功能说明与管理员操作](FEATURES_README.md)
- [主后端完整接口与部署配置](BACKEND_API_README.md)
- 后端与插件验证记录位于平台仓库：`xrugc-platform/docs/sn-device-login-verification.md`。

## 1. 接入前准备

向后端负责人取得：

1. 本环境权威 API 根地址，例如 `https://api.example.com`，或带代理前缀的
   `https://app.example.com/api`。这些是占位地址，不是可用服务。
2. 绑定到正常普通账号的测试 SN；生产前使用正式签名安装包验证 UUID 稳定性。
3. 确认后端已迁移 `device_sn`、配置服务依赖；identity 模式还需升级来源字段及签发服务。

下文路径均相对 API 根地址，统一拼接为 `apiBase.TrimEnd('/') + "/v1/..."`。
根地址不要包含 `/v1`；带 `/api` 的环境不要再重复添加 `/api`。

全程使用同一环境、同一权威入口。未经后端确认双侧数据库一致性，不自动切换第二后端。
生产使用 HTTPS，保持正常证书验证；认证请求不跟随重定向，把 3xx 当作入口配置问题处理。
真机访问开发机时须使用真机可达的开发地址，真机上的 `localhost` 指向真机自身。

## 2. SN 与 UUID 约定

| 项目 | 约定 |
|---|---|
| SN | 去掉 ASCII 空白和连字符并转大写后，长度严格为 16 位或 32 位；字符集 `0123456789ABCDEFGHJKMNPQRSTVWXYZ` |
| SN 显示 | 新码为 4 组 × 4 位，含连字符共 19 个字符；历史码仍为 8 组、39 个字符；不自动把 I/L/O 等转换为数字 |
| 请求长度 | 原始 SN 字符串最多 128 字节；UUID 原始字符串最多 255 字节 |
| UUID | 首尾去空白、统一小写；规范化后匹配 `[a-z0-9][a-z0-9._:-]{0,254}`，不要求 RFC 4122 格式 |
| 绑定关系 | 一 SN 对应一个账号和一个 UUID；同账号多设备各自使用不同 SN |
| 有效期 | SN 永久有效，管理员可停用；Access Token 有限期且最长 3 小时 |
| 设备登记 | 不需要提前注册设备；服务端首次激活直接写入 `device_sn.device_uuid`，不使用旧 `device` 表 |

客户端校验必须同时接受 16 位新码和 32 位历史码，拒绝其他长度；不能截断、补齐或
重新生成已有 SN。不要将输入框上限设为 19 个字符，应保留旧分组码和原始请求的
128 字节输入能力。升级客户端后，安全存储中的历史 SN 原样保留。

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
  "token": {
    "accessToken": "<JWT>",
    "expires": "2026-09-27T08:00:00.000Z",
    "refreshToken": "<refresh credential>"
  }
}
```

检查 HTTP 状态、`success` 和必需字段后，复用原 Token 管理器保存结果；允许响应包含
额外字段。`message` 不是业务状态码，不要依赖它控制流程。

后续业务请求：

```http
GET /v1/user/info
Authorization: Bearer <accessToken>
Accept: application/json
```

这是已有的账号信息接口，可作为接入后的连通与身份确认。账号身份来自服务端响应，
客户端不从 SN 推导账号，也不根据自己解析的 JWT 给用户增加权限。
其他业务请求继续使用原路径与请求格式；SN/UUID 不需要随每次业务请求上传。

### 3.4 Refresh Token 兼容入口

```http
POST /v1/auth/refresh
Content-Type: application/json

{"refreshToken":"<refresh credential>"}
```

成功结构仍为 `{success:true,message:"refresh",token:{...}}`。如原客户端已使用此接口，
必须同时替换返回的 Access Token 和 Refresh Token，禁止并行轮换同一个 Refresh Token。
每次刷新都会检查 SN 授权，停用后无法刷新。

**本次 Rokid 的默认续登录方式是 SN + UUID，非依赖 Refresh Token。**
实现时选定一个自动续登录入口，避免刷新与 SN 重登两个循环同时运行。
若采用兼容刷新流程，网络超时后不要无限重放旧 Refresh Token；它可能已被消费，
可在统一认证任务中改用一次 SN + UUID 登录恢复。

## 4. Unity 登录状态与自动续登录

建议复用现有登录管理器，增加 SN 凭据入口，并维护以下状态：

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

**到期时间处理：**

- identity 当前返回 ISO 8601 UTC，例如上面的 `expires`。
- legacy 当前返回 `yyyy-MM-dd HH:mm:ss`，按服务端时区解释；仓库默认时区为
  `Asia/Shanghai`。不要把这个无时区字符串当成 UTC 或设备本地时区。
- 统一读取 JWT payload 的数值 `exp`（Unix 秒）作为续登录排程依据；使用现有 JWT
  解析工具处理 Base64URL。解析 payload 仅用于排程，不等于验签或权限校验。
- 不要写死收到 Token 后恰好使用 3 小时。解析失败、设备时钟异常时避免高频登录循环，
  提示检查时间/协议；后端仍是鉴权的最终依据。

多个请求遇到过期时，共享同一个续登录任务。续登录成功后，仅按业务接口原有的重试约定
重试请求；对于写操作，未明确保证幂等时不得自动重放，尤其不能在网络超时后盲目重发。
业务 403 通常是权限不足，不触发重登。业务 401 可触发一次受控重登，但认证接口自身的
401 必须终止循环，不能递归调用自己。

## 5. 错误处理与重试

以 HTTP 状态为主。Yii 错误通常有 `message`，但网关可能返回非 JSON；错误体不使用成功
响应 DTO。当前未激活与冲突没有独立、稳定的业务错误码，不要匹配英文消息做分支。

| 情况 | 客户端行为 |
|---|---|
| 200 但缺少必需 Token 字段/无法解析 | 协议错误，不进入已登录状态，避免紧密重试 |
| 400 | SN/UUID 格式或请求不正确，提示修改输入 |
| 401（认证接口） | 凭据、授权、账号或身份服务校验失败；停止自动重试，保留安全保存的 SN 供管理员恢复后手动重试 |
| 403 | 不自动重登；提示权限问题并核对入口 |
| 404、405、3xx | 路径/方法/入口配置问题，核对部署与代理前缀 |
| 409 | 未激活、已绑定不同 UUID、同 UUID 被其他 SN 占用，或并发冲突；见下文 |
| 429 | 遵循 `Retry-After` 秒数，等待后重试同一请求；缺失时使用本地退避 |
| 5xx、连接中断、超时 | 按退避规则重试相同凭据；不假定服务端未完成绑定 |

当前主后端可能把 identity 来源校验失败（包括部分上游不可用错误）呈现为 401，
因此不能向用户断言“SN 一定被停用”。可提示“设备授权暂时无法使用，请重试或联系管理员”，
由后端日志排查；不要删除保存的码或进入无限自动重登。

409 的安全处理：已知首次激活请求只允许原 SN + UUID 少量重试，以容忍并发锁冲突；
重复冲突即停止，显示“设备或激活码已有绑定，请联系管理员”。正常登录的 409 最多尝试
一次同对激活恢复；不要在登录和激活之间无限切换。

建议退避为 1、2、4、8、16、最大 30 秒，每次叠加随机抖动，且 429 不早于服务端指定时间。
建议每轮最多连续 5 次暂时故障重试，之后显示等待网络/手动重试；网络恢复或重新进入前台
时只唤起一个认证任务。等待应使用不受 `Time.timeScale` 影响的计时方式，用户退出后取消。

服务端当前默认限制为每 IP 600 次/分钟、每 SN 和每 UUID 各 30 次/分钟。客户端不应
按这个上限持续轮询。不要给每个业务请求各建一个认证重试循环。

## 6. C# 请求示例

下例是传输层参考，使用 UnityWebRequest 协程与 JsonUtility；不包含平台 UUID 获取、
安全存储、JWT 排程或上一节的重试状态机。它没有在 Rokid Unity 工程中编译/运行，
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
        string apiBase, string sn, string uuid, bool activate,
        Action<SnAuthResult> completed)
    {
        // apiBase 来自可信环境配置；生产必须是 HTTPS。
        string path = activate ? "/v1/auth/sn-activate" : "/v1/auth/sn-login";
        string json = JsonUtility.ToJson(new SnLoginRequest { sn = sn, uuid = uuid });
        byte[] body = Encoding.UTF8.GetBytes(json);

        using (var request = new UnityWebRequest(apiBase.TrimEnd('/') + path, "POST"))
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
  踢下线。账号停用/删除/升级管理角色时，SN 会话也会受到限制。

## 8. Unity 联调验收清单

使用测试账号和独立测试 SN；不要用生产设备做冲突或重装实验。

- [ ] 首次输入 SN 激活成功，`/v1/user/info` 返回预期普通账号。
- [ ] 16 位新码与 32 位历史码均可输入、保存、激活及重登；分组/无分组、大小写和 ASCII 空白输入按约定处理，其他长度被拒绝，升级不截断旧码。
- [ ] 杀进程重启后无需手输 SN，使用同 UUID 登录；覆盖升级后 UUID 不变。
- [ ] 同账号两台设备使用两个 SN，均能进入同一账号的业务数据。
- [ ] 同 SN 不同 UUID、同 UUID 不同 SN 均拒绝，客户端不会自动改 UUID。
- [ ] 同 SN + UUID 重复激活成功；模拟响应丢失后原凭据可恢复。
- [ ] 到期/即将到期时自动 SN 重登；并发业务请求只产生一个认证任务。
- [ ] 401、409、429、5xx、非 JSON 响应、断网、超时均按规则处理，没有无限重登。
- [ ] 停用后新登录和刷新失败，另一设备不受影响；恢复后原 UUID 能登录。
- [ ] 账号禁用或升级管理员后拒绝 SN 会话；不尝试用二维码/OIDC 换出其他登录凭据。
- [ ] 清除本机信息、切环境、销毁登录管理器后，迟到响应不能恢复旧会话。
- [ ] 正式签名、目标 Rokid 型号上的 UUID 获取与凭据安全存储经过验证。
- [ ] 检查日志和崩溃报告，SN/Access Token/Refresh Token 未被输出。

验收记录填写 Unity 版本、Rokid 型号/系统、安装包版本及签名标识、API 环境和后端版本，
只记录 SN 尾号，不记录完整凭据。
