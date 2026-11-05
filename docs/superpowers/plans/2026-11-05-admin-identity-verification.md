# 管理员身份证自动核验与解绑实现方案

> 本方案已按用户“review 下这个方案，没问题的话就开始开发”的指令完成评审并实现。最终文件、差异及验收结果见 [开发验收记录](../reviews/2026-11-05-admin-identity-verification.md)。验收报告后，用户追加授权提交并推送；部署和使用真实身份证调用收费核验尚未执行。

**Goal:** 在 tk-mg-sys 内通过上传身份证照片调用阿里云自动核验，并由本系统管理管理员的实名绑定、解绑和访问限制。

**Architecture:** 新增 identity-verification 模块，保持 routes → service → repository 边界，将阿里云 SDK 封装在单独的 provider 中。PostgreSQL 保存当前认证状态、必要的加密身份字段和不含证件内容的核验流水；已有 audit_event 记录操作。同步调用第三方，不建立保存身份证照片的后台任务队列。

**Tech Stack:** 现有 React、Ant Design、TanStack Query、Hono、Bun、Zod、PostgreSQL、Drizzle、Redis；新增阿里云官方 Cloudauth 服务端 SDK 及其所需依赖。

日期：2026-11-05。实现位于独立工作区 `.worktrees/tk-mg-identity`，分支 `feat/admin-identity-verification`，基于 `87d4d7ce05ffe73d1314837f1bd760a0a3b6d8e6`。下文任务清单保留原设计验收项；实际证据和上线未完成项以开发验收记录为准。

## 1. 认证和解绑的边界

阿里云负责一次性的身份信息核验。我们调用 `Id2MetaVerifyWithOCR`，由其读取身份证照片上的姓名、身份证号并进行权威源比对。tk-mg-sys 决定把核验结果绑定到哪个登录账号，并管理权限。

所以，解除 tk-mg-sys 的身份证绑定只需要本地事务，不需要调用阿里云解绑接口。该接口的公开请求模型也没有 tk-mg-sys 的用户 ID 或业务绑定对象。这是基于接口合同作出的集成设计判断，不代表阿里云不存在核验记录。

必须区分三件事：解除本系统绑定、删除本系统保存的身份资料、处理阿里云侧已经产生的核验资料/调用记录。普通解绑执行前两项中规定的清理；不宣称它会清除云端数据或退还已发生的核验费用。云端留存期限及删除渠道需按所购服务合同和客服确认，不能套用其他产品的删除 API。

本方案是身份信息二要素核验，不能证明上传者正在持有身份证，也不包含活体检测、人脸比对或证件图像真实性的完整鉴定。[阿里云产品说明](https://help.aliyun.com/zh/id-verification/information-verification/product-overview/what-is-information-verification)

## 2. 建议采用的业务规则

用户已确定：使用阿里云、上传身份证、第三方自动核验，并需要解绑。以下默认规则按本次开发授权落实。部署默认 off；管理员强制门禁需显式切换 enforced。

| 事项 | 建议默认值 |
| --- | --- |
| 认证对象 | `role=administrator` 且 `provisioned_by=init-tool` 的管理员 |
| 平台账号 | `role=administrator` 且 `provisioned_by=sys`，免认证；可管理认证列表和解绑 |
| 普通成员 | 本期不收集其身份证，不增加其个人实名门禁 |
| 未认证管理员 | 登录成功，但只可访问实名认证、会话查询、退出登录；业务 API 返回明确的实名未完成错误 |
| 身份证唯一性 | 同一身份证同时只能绑定一个管理员账号；同一账号只能有一份当前绑定 |
| 解绑权限 | 仅平台管理员可以解绑，必须重新验证操作人的密码并填写原因 |
| 自助解绑 | 本期不开放；管理员联系平台处理 |
| 解绑后 | 目标管理员重新进入未认证状态；再次绑定必须重新上传、重新核验 |
| 换绑 | 平台先解绑，再由目标管理员重新认证；不提供直接编辑姓名/身份证号功能 |
| 认证有效期 | 本期没有人为设置的年度复核期限；解绑后失效，不复用历史通过记录 |
| 上传材料 | 首期只收人像面，国徽面不收集；本期不验证身份证有效期 |

人像面已包含本接口要核验的两项信息，阿里云接口允许省略国徽面。若产品以后需要有效期校验，应单独增加相关材料和验证规则，不能把国徽面 OCR 日期当作权威源有效期核验。[接口说明](https://help.aliyun.com/zh/id-verification/information-verification/developer-reference/identity-ii-verification-ocr-support)

权限限制的范围是管理员本人。解绑不等于停用账号、冻结整个团队、停止下属成员或取消已有任务。如果希望“所属管理员未认证时，所有成员也不能使用”，需要另行定义可靠的团队负责人关系；不能直接按 `parent_user_id` 或任意共享分组猜测归属。

## 3. 已核对的项目接入点

| 现有位置 | 事实及本次用途 |
| --- | --- |
| `apps/api/src/db/schema/auth.ts` | app_user 已有 role、provisioned_by、enabled、parent_user_id；另有会话和审计表 |
| `apps/api/src/modules/auth/postgres-repository.ts` | 已读取账号来源，用于 init-tool 管理员的分组限制；会话每次重新读取用户 |
| `apps/api/src/modules/auth/service.ts` | 登录及会话 principal 尚无实名认证状态，增加非敏感状态摘要 |
| `apps/api/src/modules/access/administrator-authorization.ts` | 名为管理员授权，但允许有成员页权限的普通成员进入；不能直接复用于实名平台管理权限 |
| `apps/api/src/modules/box-service.ts` | 已用 administrator + sys 判断平台管理员；同样的判定用于本模块 |
| `apps/api/src/lib/crypto.ts` | 已有 AES-256-GCM 加解密，可复用 SecretCipher |
| `apps/api/src/app.ts` | 基础路由注册位置；实名门禁必须在业务路由注册前安装 |
| `apps/api/src/composition.ts` | 生产依赖组装；支付、box-link、dispatch 还会在 createApp 之后注册，门禁必须覆盖这些路由 |
| `apps/web/src/components/layout/protected-route.tsx` | 已登录后直接渲染 AdminShell；增加实名状态判断和无重定向循环的认证入口 |
| `apps/web/src/lib/api/auth-api.ts` | 会话响应由 Zod 解析；同步扩展字段，不能只改后端 |
| `apps/web/src/features/auth/auth-provider.tsx` | 使用 auth/session 查询缓存；认证成功/解绑后主动失效刷新 |
| `apps/api/src/modules/members/routes.ts` | 成员列表隐藏其他 administrator；另建平台认证列表，不能假设这里能列出所有管理员 |
| `infra/nginx*.conf` | 现有 3m 限制多位于 agent 等 location，不能假设身份证上传的 /api 路径已有相同限制 |

只修改 tk-mg-sys。init-tool 和 Agent 保持只读，不新增源库字段，不改变同步协议。认证数据绑定业务库用户 UUID；同一 UUID 的密码/邮箱同步不清除认证，停用账号不能使用认证结果。重新创建且映射为不同 UUID 的账号必须重新认证。

## 4. 用户流程和页面

管理员进入 `/identity-verification` 后，看到用途说明、向阿里云传输材料的说明和独立且默认未勾选的同意项。选择身份证人像面图片，页面仅生成当前页面内的预览，点击提交后锁定按钮。

后端不采信浏览器传入的姓名、身份证号、认证状态或目标用户 ID。当前用户由会话确定，最终身份字段只取自经过验证的服务端阿里云响应。

认证成功显示脱敏姓名、脱敏身份证号、认证时间；刷新 auth/session 后进入允许访问的原站内页面。失败区分图片问题、信息不一致、身份已被绑定、服务暂不可用。发生超时时，先查询本地流水结果，不能自动再次扣费核验。

平台新增 `/identity-verifications` 页面，复用现有布局和表格样式。支持按账号、状态、时间分页查询，展示账号、脱敏身份、状态、核验时间和解绑记录。禁止完整身份证号搜索、批量导出或读取原图。解绑弹窗展示目标账号和后果，要求原因及操作人密码。

普通成员不能访问平台认证页面。认证中、读取状态失败和后端不可用时，前端均不得乐观显示“已通过”。新认证页不依赖已被门禁禁止的成员、素材、设备等接口。

## 5. 数据模型

采用两张业务表，另加 identity_password_failure 保存解绑密码失败窗口，复用已有 audit_event；不用一个布尔字段覆盖所有历史。

### admin_identity_verification：每个账号一行当前状态

| 字段 | 类型/用途 |
| --- | --- |
| user_id | UUID 主键，引用 app_user，删除限制为 restrict |
| status | unverified / verifying / verified / rejected / error / unbound |
| version | bigint，默认 0；每次开始核验、解绑或作废时递增，防止旧响应写回 |
| current_attempt_id | 当前或最近一次核验流水 UUID；没有时为 null |
| name_encrypted / cert_no_encrypted | 成功绑定后的必要身份字段，使用现有 AES-GCM 加密；其他状态为空 |
| name_masked / cert_no_masked | 展示字段，例：张*、110***********1234；仅当前绑定存在时保存 |
| cert_no_hmac | 使用专用密钥的 HMAC-SHA256，用于当前有效绑定查重 |
| hmac_key_version | HMAC 密钥版本；不能因服务重启生成新密钥 |
| verified_at / unbound_at | 通过及解绑时间 |
| last_error_code | 本地枚举错误码，不保存云端原始错误文本 |
| created_at / updated_at | 创建和更新时间 |

数据库约束：每用户最多一行；只有 verified 状态允许持有身份字段，且该状态要求所有关键身份字段非空；其他状态清空这些字段。增加以下部分唯一索引，确保并发认证不能绕过一证一号规则：

```sql
CREATE UNIQUE INDEX admin_identity_verified_cert_unique
ON admin_identity_verification (cert_no_hmac)
WHERE status = 'verified';
```

身份证号码规范化为去掉首尾空白、末尾 x 转大写 X，校验长度、校验位等格式后再计算 HMAC。格式校验只是数据完整性检查，不替代第三方核验。HMAC 密钥独立于 SECRET_ENCRYPTION_KEY；轮换需维护一致的查重策略，不能按新版本并行分区而允许同证重复。可在维护窗口暂停新绑定、解密现有有效绑定重算，再恢复调用。

### identity_verification_attempt：每次核验一行

保存 id、user_id、binding_version、idempotency_key、request_fingerprint、status、provider、provider_request_id、provider_code、provider_biz_code、local_error_code、consent_version、consented_at、started_at、deadline_at、finished_at。

流水状态为 verifying / verified / rejected / error / superseded。`verified` 表示该流水曾完成本地绑定，解绑后流水不再代表当前有效认证。有效状态必须从当前表读取。

唯一约束为 `(user_id, idempotency_key)`。request_fingerprint 是带密钥的材料和同意版本摘要，用于判断同一请求键是否被用于不同内容，不是原图，也不用于跨用户查询。流水不保存原图、姓名、完整证件号、地址、民族、出生日期、人像裁剪或阿里云原始响应。

必要索引为 `(user_id, started_at desc)` 及 verifying 状态的 deadline_at。成功/失败流水及审计保持现有历史保留原则；图像摘要只用于短期幂等窗口，建议 24 小时后清空摘要并将重复旧键返回为已过期，而不是重新调用第三方。

## 6. 核验事务、幂等与超时

1. 验证会话、账号类型、账号 enabled 状态、同意版本、文件格式/大小并计算摘要。先查询幂等结果及当前状态，再做实际解码；解码并发限制为每进程 2 个且不排队，最后在事务内重新检查状态并预占调用限额。已有请求重放不受新调用额度限制。文件与参数不合格时不调用阿里云。
2. 由前端生成 UUID 作为 Idempotency-Key。短事务创建/锁定当前行；相同键且相同内容返回已有流水结果；相同键内容不同返回 409；已认证返回 409；已有 verifying 返回其流水，禁止并发再发一次。
3. 新建流水，当前状态设为 verifying，version 加一，记录 current_attempt_id。使用数据库原子计数/锁保证多实例不能绕过状态限制；事务提交后才调用云服务。
4. 在事务外调用阿里云。禁用 SDK 自动重试与自动切换服务地址重试；避免网络不确定时多次计费。
5. 只接受 `Code === "200"`、`ResultObject.BizCode === "1"` 且 CardInfo 可解析、关键字段有效的响应。HTTP 200 或外层 Code=200 单独出现均不代表身份通过。BizCode=2 记为信息不一致；缺失/未知字段按异常处理。[结果字段说明](https://help.aliyun.com/zh/id-verification/information-verification/developer-reference/identity-ii-verification-ocr-support)
6. 最终短事务重新锁定当前行，核对 version、current_attempt_id、verifying 状态、deadline 和用户仍有效且仍属于认证对象；计算 HMAC，写有效绑定、流水和审计。唯一约束冲突时回滚绑定，再以相同版本条件记录 identity_already_bound；不透露其他账号的信息。
7. 解绑、账号停用、超时失效或新请求已更换版本时，旧响应不能建立绑定。数据库写入/审计失败不向用户返回成功，不自动重放第三方请求。

采用同步 POST 完成正常调用，前端上传请求超时 45 秒；云端整体处理预算建议 30 秒，连接超时 3 秒、各步骤读取超时 10 秒，关闭自动重试。整体预算必须覆盖 SDK 上传和核验的全部步骤。SDK 若不能真正中断请求，需要阻止超时后的状态写回并等待在途资源释放，不能把 Promise.race 当作网络已取消。

流水设置 90 秒处理租约。POST 连接中断后，用户可通过 GET 查询本地状态；后台每分钟及再次读取/提交前，把超过租约的 verifying 以版本条件标为 error。进程重启也不会永久卡在认证中。超时后必须重新选择/保留前端材料并由用户主动提交新请求；系统不保存照片以自动重试。该同步接口不设计支付宝式的 certifyId、回调通知或轮询阿里云结果接口。

默认限额建议：每用户每 60 秒 1 次新调用、每日 5 次；平台每日 1,000 次，UTC+8 计日。限额全部由 PostgreSQL 执行，避免依赖现有 Redis 无限重试行为；数据库事务取得以日期为键的 advisory lock，按当天已创建的 attempt 计数检查平台/用户限额，然后插入流水预占预算，避免多实例竞争；无需再建预算表。超时和占位后的进程崩溃也占用预算，不通过自动退还额度反复调用。计数不可用时拒绝新调用，查询本地状态和已有认证账号的业务访问保持可用。用量阈值是运营参数，不写死在页面。

## 7. 解绑事务

接口只接受平台账号的有效会话。重新使用密码哈希验证操作人密码，不读取现有 password_plain 字段；操作密码不写日志。对密码验证增加 5 次/15 分钟的失败限制，并验证请求来源/CSRF 防护。

请求携带目标 userId、expectedVersion、reason 和独立幂等键。reason 限制 1–200 字，提醒不要输入证件号等个人资料。由服务端核对目标是 init-tool 管理员。解绑幂等凭据保存在本次 audit_event.metadata 的 idempotencyKey 和 expectedVersion 中；新增仅针对 `identity.unbind` 事件的 `(actor_id, target, metadata->>'idempotencyKey')` 部分唯一索引。相同键同目标同版本返回既有操作结果，不再解绑；同键不同版本或原因返回 409。查询历史结果也必须先通过当前平台权限与密码复核。

一次事务完成：

1. 统一按用户行 → 当前认证行加锁；核验完成、解绑及 init-tool 同步撤销会话保持相同顺序。expectedVersion 不符返回 409，要求刷新页面，防止旧弹窗解绑新的认证。
2. version 加一；状态设为 unbound；把在途流水标为 superseded。
3. 清空当前姓名/身份证号密文、脱敏字段、HMAC 和 current_attempt_id，记录 unbound_at，释放一证一号唯一占用。
4. 撤销目标管理员的全部会话；不会撤销平台操作人的会话。
5. 同一事务写审计：操作人、目标用户、旧/新版本、解绑原因、时间、关联流水 ID。身份值不复制到审计。

重复解绑无绑定的用户时返回当前状态，不重复审计、不追加云调用；同一幂等键只能复用既有结果。若期间完成了新绑定，旧 expectedVersion 必须失败。

本地提交成功即解绑成功，不依赖阿里云是否可用。执行中的业务请求或已派发任务不追溯撤销；之后的新业务请求由最新状态和已撤销会话阻止。历史订单、盒子权益、任务、审计及 init-tool 账号不随解绑删除。备份中的旧密文按现有备份周期处理，不把在线字段清空描述为全系统即时物理删除。

## 8. API 合同

| 方法与路径 | 权限 | 入参/结果 |
| --- | --- | --- |
| GET /api/identity-verification/me | 已登录的认证对象 | 当前状态、version、脱敏身份、lastErrorCode、currentAttemptId、providerAvailable、consentVersion |
| POST /api/identity-verification/attempts | 已登录的认证对象 | multipart 的 frontImage、consentVersion、consentAccepted=true；Idempotency-Key 请求头 |
| GET /api/identity-verification/attempts/:id | 流水本人 | 本地状态、可重试性、错误码；越权按 404 处理，不查询阿里云 |
| GET /api/platform/identity-verifications | 平台管理员 | page、pageSize≤100、账号关键词、状态、时间；分页脱敏列表 |
| GET /api/platform/identity-verifications/:userId/attempts | 平台管理员 | 仅核验/解绑事件及错误类别，不暴露原始身份证资料 |
| POST /api/platform/identity-verifications/:userId/unbind | 平台管理员 + 密码复核 | expectedVersion、reason、operatorPassword；幂等键 |

正常业务判定包括认证不一致时，POST 返回已持久化的流水结果，前端按 status 处理；处理中重复请求返回 202。协议/权限/资源错误使用：400 invalid_request 或 consent_required、401 authentication_required、403 identity_verification_required/forbidden、404 not_found、409 identity_already_bound/already_verified/stale_version/idempotency_conflict、413 image_too_large、415 unsupported_image、429 rate_limited、503 identity_provider_unavailable、504 identity_provider_timeout。若云端异常已生成流水，错误响应带本地 attemptId，便于随后查询。

云端 Code=405/420/421/440 归类为图片问题；410/411/412 归类为服务未就绪；402/403/500 等按限流或服务异常分类，不能显示为“身份证为假”。不将三要素核验的 SubCode 当作二要素接口结果。[服务端错误码](https://help.aliyun.com/zh/id-verification/information-verification/developer-reference/error-code-info-check)

## 9. 会话、门禁及兼容

会话新增 identity 摘要：required、status、canAccessBusiness、version，以及明确的 isPlatformAdmin。均由服务端账号来源与数据库计算，前端不得自行推导平台权限。

在 createApp 的业务路由注册前，安装 `/api/*` 门禁，顺序为会话认证 → 实名判定 → 现有页面及分组授权。认证通过不增加任何角色、页面权限或分组访问权。查询身份状态失败时，要求认证的账号拒绝业务访问，不能默认通过。

按方法和完整路径保留登录、退出、会话查询、本人核验、平台管理接口的通路；各接口仍执行各自权限检查。显式放行现有 `POST /api/pay/alipay/notify` 让其原有验签继续运行，不能按路径包含 notify 泛化放行。`/agent/*`、health、ready 不是人类账号门禁对象，不改变它们的鉴权。

支付/dispatch/box-link 在 composition 中晚注册，需用生产组装级测试证明它们也经过门禁。解绑不会打断 Agent 心跳、领取、回报或已经发生支付的到账通知。

前端 ProtectedRoute 放行已登录但未认证者的认证页面，业务路径才跳转；避免认证页也被 PageGuard 或导航权限反复跳回。HTTP 403 identity_verification_required 刷新会话并跳转；401 仍按会话失效处理。认证提交成功和解绑完成均主动 invalidate auth/session；切换账号清空前一用户的核验缓存及图片预览。

上线配置采用 `off | optional | enforced` 三种模式。optional 提供认证入口但不拦业务，enforced 对指定管理员强制；off 关闭入口及门禁但保留记录。服务欠费、密钥错误或超时不会自动从 enforced 降级为 optional/off。已有 verified 用户的日常请求不访问阿里云。

## 10. 阿里云接入与材料处理

开通阿里云中国站“信息核验”服务，前提是企业实名认证。它与金融级实人认证是独立产品，不能复用支付宝应用签名或假设已有支付宝支付资质就能调用。[开通文档](https://help.aliyun.com/zh/id-verification/information-verification/bzagds5rl241tuv2)

后端使用官方 `@alicloud/cloudauth20190307` SDK 的文件流 Advance 方式，通过 CertFileObject 上传；地域/endpoint 采用配置白名单，固定 HTTPS 服务地址，不接受用户传入图片 URL 或服务地址。

已核实官方 TypeScript SDK 包含 `id2MetaVerifyWithOCRAdvance`。该方法内部先获得上传参数，把文件上传至阿里云 OSS，再发起核验。因此“本系统不保存原图”不等于“图片从未存储在第三方”。上线前确认所用 SDK 版本的上传行为、阿里云材料留存及删除说明；锁定通过 Bun 集成验证的 SDK 版本。不得承诺不存在云端文件或凭空指定其自动删除期限。[官方 SDK 源码](https://github.com/aliyun/alibabacloud-typescript-sdk/blob/master/cloudauth-20190307/src/client.ts)

本系统只在请求处理期间持有图片，不写 NAS、素材库、数据库、Redis、任务队列、浏览器 localStorage 或诊断附件。前端退出/切换账号撤销对象 URL；后端完成或失败后释放流和缓冲区引用。日志过滤必须覆盖 SDK 异常对象，禁止直接打印其 request/body/response。

文件只接受实际可解码的 JPEG/PNG，单张上限取保守的 2,000,000 字节，宽高必须在 65–8191 像素内，并设像素总量上限避免解码占用过大；不接受 SVG、GIF、PDF、HEIC 或远程 URL。前端校验方便用户，后端重新校验才是安全边界。

为上传 endpoint 单独配置 nginx `client_max_body_size 3m`，应用限制 multipart 总体不超过 2.5 MB；只调整该 location，不放宽所有 API。配置 nginx 请求流式转发，检查上传解析库没有临时文件落盘，身份证接口禁用响应缓存与请求体日志。测试真实 nginx 链路，不只测试 Vite。

Consent 内容至少写明用途、传输给阿里云、核验字段、保存内容、解绑与删除的区别和联系渠道。保存同意版本与时间，不使用预勾选，也不把阿里云完整结果留作“证据”。正式文案应与所开通产品的服务条款一致。

## 11. 配置、费用与运行

| 配置 | 用途 |
| --- | --- |
| ADMIN_IDENTITY_MODE | off / optional / enforced；部署先 optional |
| ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET | 服务端专用 RAM 凭据，部署环境注入 |
| ALIBABA_CLOUD_SECURITY_TOKEN | 使用临时凭据时注入 |
| ALIYUN_IDENTITY_REGION | cn-beijing 或 cn-shanghai，映射固定 endpoint |
| IDENTITY_HMAC_KEY / IDENTITY_HMAC_KEY_VERSION | 独立且持久的查重密钥与版本 |
| SECRET_ENCRYPTION_KEY | 复用现有加密密钥；格式仍须为 32 UTF-8 字节 |
| IDENTITY_DAILY_LIMIT / IDENTITY_USER_DAILY_LIMIT | 默认建议 1000 / 5，可通过部署配置调整 |

API 启动时验证启用模式下必需配置的存在与格式，日志只说明缺失的变量名。业务 readiness 检查本地依赖和 schema，不以真实身份证调用作为探活；云服务可用性用调用指标与经过授权的联调确认。

阿里云公开价格为二要素 OCR 核验 0.2 元/次，得到一致或不一致业务结果均计费；1,000 次按目录价约 200 元，实际以购买合同/账单为准。解绑本身不调用云接口，不产生这项核验调用费用；重新认证会产生新调用。[计费文档](https://help.aliyun.com/zh/id-verification/information-verification/product-overview/eo5ytn0ml54ddd8f)

指标记录调用数量、成功率、错误类别、超时率、耗时、处于 verifying 的数量和解绑次数；日志只使用本地流水 ID、RequestId、状态码、耗时，不含姓名、身份证、HMAC、照片或密钥。

## 12. 实施任务及文件范围

执行期间只改本仓库。当前检视分支为 feat/scan-lock-and-quota，工作区原本干净；仓库 AGENTS.md 有历史分支约束，已基于当前 HEAD 创建独立功能分支，没有切回已不存在的历史分支。本方案文档不附带 commit/push/部署授权。

### 任务 1：新增模型及持久化

新增 `apps/api/src/db/schema/identity-verification.ts`、`apps/api/src/db/migrations/0061_admin_identity_verification.sql`、`apps/api/src/modules/identity-verification/repository.ts`、`postgres-repository.ts`、`postgres-repository.test.ts`；追加 migration journal，并在同一新增迁移中加入 audit_event 的解绑幂等部分唯一索引，不更新旧审计记录。0061 是当前目录下的候选下一个编号，执行时重新确认避免撞号，不修改已发布迁移。

- [ ] 先建立可丢弃库中的约束测试：同用户两行失败、两个 verified 同证失败、unbound 不占用唯一键、非法状态/缺字段失败。
- [ ] 实现当前行、流水、版本 CAS、事务内审计，以及同时提交/解绑的锁顺序。
- [ ] 验证两连接竞争同一 HMAC 时仅一个成功；另一方状态可恢复，不能留下永远 verifying。
- [ ] 验证迁移在现有结构副本上追加执行，不删账号、会话、任务、支付或审计数据。

### 任务 2：云端适配器和运行配置

新增 `modules/identity-verification/provider.ts`、`aliyun-provider.ts`、`configuration.ts`、`aliyun-provider.test.ts`；修改 `apps/api/package.json`、锁文件、`apps/api/src/main.ts`、`composition.ts`、`infra/.env.example` 和实际 Compose 配置的环境传递。

- [ ] 为 Code=200/BizCode=1、BizCode=2、外层异常、缺失 CardInfo、非法身份证、未知字段和 SDK 超时建立 provider 合同测试。
- [ ] 接入官方 SDK，禁用自动重试，统一处理结果和脱敏错误。
- [ ] 测试文件流上传在 Bun 中可用，确认 SDK 上传依赖和端点，锁定版本。
- [ ] 测试启用状态缺凭据、错误密钥长度、未知 endpoint 配置会明确失败且不回显秘密。

### 任务 3：核验服务与本人接口

新增 `modules/identity-verification/service.ts`、`routes.ts`、`service.test.ts`、`routes.test.ts`，及小型身份字段规范化/上传校验文件；修改 app.ts/composition.ts 注入依赖。

- [ ] 建立测试：前端伪造身份值无效、未授权同意不调用云端、同请求键不重复调用、不同内容同键 409、旧响应不能覆盖新版本。
- [ ] 实现上传校验、限额预占、同步云调用、最终事务和本地状态查询。
- [ ] 测试云端通过但本地唯一键/审计写入失败时不会返回已认证。
- [ ] 增加超时租约清理与读时修复；进程重启后的 verifying 最终能进入可重试状态。

### 任务 4：平台列表及解绑

新增 `modules/identity-verification/platform-routes.ts`、`platform-authorization.ts`、`platform-routes.test.ts`；repository 增加平台分页和解绑事务。

- [ ] 测试 init-tool 管理员和仅拥有 /members 权限的成员均不能进入平台接口；平台 sys 管理员可以。
- [ ] 实现操作密码复核、expectedVersion、幂等、原因与事务内撤销会话/清空身份/审计。
- [ ] 测试解绑与核验返回的两个执行顺序；重复解绑不改新认证，停用目标不接受旧核验。
- [ ] 测试解绑成功后原身份证能被另一个账号重新核验绑定，且不复用历史通过结果。

### 任务 5：后端门禁与会话

修改 `modules/auth/service.ts`、`modules/auth/postgres-repository.ts`、auth 对应测试；新增 `modules/identity-verification/middleware.ts`、`middleware.test.ts` 和生产组装测试 `apps/api/src/identity-gate.integration.test.ts`。

- [ ] 在 app.ts 的所有业务路由之前安装门禁，保留原权限判定的内部顺序。
- [ ] 精确覆盖认证例外、支付通知、Agent 和健康检查，不使用广泛子串匹配。
- [ ] 通过生产组装测试覆盖晚注册的购买、任务、box-link 和 dispatch 路由，避免只测 createApp 漏掉真实路径。
- [ ] 测试 optional/enforced/off，解绑后的旧会话、已认证后的新会话以及数据库状态读取失败。

### 任务 6：前端与网关

新增 `apps/web/src/features/identity-verification/api.ts`、`page.tsx`、`platform-page.tsx`、`page.test.tsx`；修改 `lib/api/auth-api.ts`、`features/auth/auth-provider.tsx`、`components/layout/protected-route.tsx`、`components/layout/admin-shell.tsx`、`app/router.tsx`，以及前后端 `lib/pages.ts` 的必要页面定义和测试。新增 `apps/web/e2e/identity-verification.spec.ts`。

- [ ] 实现本人上传页、状态提示、失败重试、平台分页/解绑弹窗，保持现有 Ant Design 视觉和导航方式。
- [ ] 测试认证页无循环跳转、普通成员没有平台菜单、后端 403 能恢复状态、已退出用户没有前一用户图片缓存。
- [ ] 为上传路由配置 nginx 上限、超时、流式转发；验证最大允许图片经过真实网关能到达后端，超限在云调用之前拒绝。
- [ ] 浏览器视觉验收覆盖窄屏、错误态、加载态、成功态、键盘上传/确认和解绑后重新登录；实际验收不能只依赖组件 mock。

### 任务 7：回归、联调和发布说明

更新 `docs/后端完善与联调说明.md`，记录配置、开通产品、迁移、门禁范围、回滚和真实联调证据。

- [ ] 运行下面的类型、构建、单元、数据库和浏览器检查，报告真实通过/失败/跳过情况，不把未配置数据库的 skip 算作通过。
- [ ] 在企业账号服务开通后，用经授权的测试材料完成真实成功、失败和 RequestId 对照；真实身份证不进入自动化测试、Git、日志或报告截图。
- [ ] 准备 optional 灰度 → enforced 的操作说明和回滚说明；计划阶段不实际开通云服务、充值或发送材料。

## 13. 验证命令与验收矩阵

```sh
pnpm typecheck
pnpm --filter @tk-mg/web build
bun test apps/api/src/modules/identity-verification
pnpm --filter @tk-mg/api test:postgres
pnpm --filter @tk-mg/web exec vitest run src/features/identity-verification
pnpm --filter @tk-mg/web exec playwright test --config playwright.identity.config.ts
pnpm lint
```

PostgreSQL 测试必须由执行环境提供 TEST_DATABASE_URL，数据库名称仅允许 `tk_mg_test_*`；测试帮助函数会重建 schema，不得指向业务库或初始化库。完整回归再执行 `pnpm test`；真实 nginx/API/数据库 E2E 使用隔离部署和相应测试配置。

| 场景 | 验收结果 |
| --- | --- |
| 上传有效身份证，云端明确一致 | 当前状态 verified，审计与流水同事务持久化，前端刷新进入业务页 |
| 只得到 HTTP 200 或 Code=200 | 不得直接判定通过 |
| 证件号或姓名 OCR 字段缺失/非法 | error，不建立部分身份绑定 |
| 未同意、超大/伪装图片、请求远程 URL | 云调用次数为 0 |
| 重复点击/客户端超时后重复同键 | 云端最多发起本系统允许的一次核验；查询返回已有状态 |
| 两账号同时核验同一身份证 | 仅一份有效绑定，另一个得到脱敏的已占用提示 |
| 云端超时、服务欠费、RAM 无权限 | 不通过；已有已认证账号可继续工作，不自动重试收费 |
| 解绑时旧核验尚在返回 | 旧响应不能恢复绑定 |
| 使用旧解绑弹窗对新认证操作 | expectedVersion 冲突，保持新认证 |
| 普通管理员/有成员页权限的成员调用平台接口 | 拒绝且不泄露目标身份 |
| 前端绕过页面直接调用购买/任务 API | enforced 下返回 identity_verification_required |
| 解绑后另一个浏览器持旧会话 | 拒绝；重新登录后仍需认证 |
| 已支付订单回调、Agent 心跳和任务回报 | 原签名/令牌验证与业务流程保持有效 |
| 初始化同步改密码/邮箱/停用 | 身份绑定不被覆盖，停用和会话撤销仍然生效 |
| 日志、审计、列表、错误响应扫描 | 没有原图、姓名/证件明文、云密钥或原始 SDK 响应 |

## 14. 上线和回滚

先备份业务库，在副本验证新增迁移；部署配置好凭据与密钥的后端，门禁设 optional，再发布前端。完成真实核验、解绑和生产组装回归后，通知现有管理员并切 enforced，不把现有账号批量标记为已认证。

回滚优先使用明确的模式配置并回退应用版本；不 drop 新表，不回滚已经产生的历史/审计，不变更 init-tool 或 Agent。关闭强制模式会放宽业务门禁，这是显式运营操作，不能由云端异常自动触发。密钥与数据库必须一起纳入受控备份，丢失 HMAC 密钥会破坏查重，丢失加密密钥会使现有密文无法读取。

第 2 节业务默认值已实现；变更强制范围、唯一性、解绑权限及材料范围应另行调整。云端删除/留存说明、SDK/Bun 文件流真实联调属于上线验证条件，不阻止先实现本地模型、接口和测试。
