# 后端请求 API

本手册对应当前 `apps/api/src/app.ts` 挂载的 HTTP 路由及生产 `main.ts` 的 `/ready`。
按请求路径组织，供前端联调；字段以各模块的 `routes.ts`、`service.ts` 中的 Zod schema
为准。这里不包含前端本地 mock 的营销、商城、脚本和任务模板操作，也没有旧
`operation_task*` 的 HTTP 接口。

## 通用约定

- 浏览器从同源 `/api` 发请求，携带登录 Cookie `tk_mg_session`（HttpOnly、Secure、
  SameSite=Strict）。JSON 请求用 `Content-Type: application/json`；`GET`/`DELETE`
  无正文的请求不传 JSON。成功状态以表中标记为准，未注明者为 200。
- `:groupId`、`:deviceId`、`:instanceId`、`:memberId`、`:accountId`、`:proxyId`、
  `:resourceId`、`:taskId`、`:commandId` 为 URL 路径参数；业务 ID 均是 UUID。
  分组接口按登录用户的 `scope.groupIds` 隔离；跨组通常返回 404，不代表资源不存在。
- 除认证和健康检查外都需要会话。`401 {"error":"authentication_required"}` 表示未登录；
  `403 {"error":"permission_denied"}` 表示已登录但缺少业务权限或页面权限；部分
  仅管理员/页面限定的接口以 404 隐藏。删除还需该页面的 `canDelete=true`，不能用
  `canView` 代替。管理员特权及明确列出的特殊规则见各模块。
- 一般 JSON 错误为 `{ "error": "code" }`。400 表示请求校验失败，409 表示资源冲突；
  具体错误码见各表。服务端异常不是前端可重试成功的证据。
- 分页接口使用 `page`（从 1 开始，默认 1）与 `pageSize`（默认 20，范围 1-100），
  返回 `{ "items": [...], "total": 0, "page": 1, "pageSize": 20 }`；仅注册资源的
  `page` 上限是 10000。不分页的列表使用 `{ "items": [...] }`。
- 账号密码、代理凭据、存储凭据和 webhook 密钥仅用于写入，不回显；枚举和字段定义以
  以下表格为准。日期型 DTO 序列化为 ISO 时间字符串，任务 DTO 的时间戳例外（Unix 毫秒）。

权限缩写：`DR/DW` 为 `devices:read/write`，`OR/OW` 为 `operations:read/write`，
`RR/RW` 为 `resources:read/write`。表内如 `DR+Devices` 表示同时要求业务权限和
精确页面 `canView`，`+删` 表示另需该页面 `canDelete`。管理员专用接口单独标注。

## 健康、登录与分组

| 方法 | 路径 | 用途 | 权限 | 请求 | 成功响应 / 错误 |
| --- | --- | --- | --- | --- | --- |
| GET | `/health` | 探测 API 进程是否存活，不检查依赖 | 无 | 无 | `{status:"ok"}` |
| GET | `/ready` | 检查 API 是否具备对外服务条件 | 无 | 无 | `{status:"ok"}`；依赖未就绪时 503 `{status:"unavailable"}` |
| POST | `/api/auth/login` | 用邮箱密码登录并建立会话 | 无 | `{email,password}`：合法邮箱、非空密码 | 200 `{user:{userId,email,displayName,scope}}` 并设置 Cookie；400 `invalid_login_request`，401 `invalid_credentials` |
| POST | `/api/auth/logout` | 撤销当前会话并清除 Cookie | 无 | 无；带 Cookie 撤销当前会话 | 204，无响应体 |
| GET | `/api/auth/session` | 页面加载时恢复登录用户和权限 | 登录 | 无 | 200 `{user:{userId,email,displayName,scope}}`；401 `authentication_required` |
| GET | `/api/access/groups` | 获取设备页可选择的分组 | DR+Devices | 无 | `{items:[{id,name}]}`，仅当前可见分组 |
| GET | `/api/groups/:groupId/resources` | 资源访问占位探测，尚不提供真实资源 | RR+StudioTextPool | 无 | `{groupId,resources:[]}`；当前为占位空数组，不是运营资源列表 |
| GET | `/api/foundation/configuration` | 探测配置写入授权，不读配置 | `configuration:write`+Configuration | 无 | `{status:"authorized"}`；权限探测，不是设置数据 |

`scope` 含 `role`、`groupIds`、`permissions` 和 `pages:[{key,canView,canDelete}]`。
角色包括 `administrator`、`operator`、`operations_director`、`salesperson`、
`sales_director`、`engineer`、`engineering_director`。使用 `scope.pages` 控制入口，
不能仅凭角色推断是否有某页面权限。

## 成员、页面权限与审计

本节 `/api/members/**` 仅管理员可访问，非管理员返回隐藏式 404。

| 方法 | 路径 | 用途 | 请求 | 成功响应 / 错误 |
| --- | --- | --- | --- | --- |
| GET | `/api/members` | 管理员查看成员名单 | 无 | `{items: Member[]}` |
| POST | `/api/members` | 新建登录成员并初始化权限 | `{email,password,role,groupIds?,displayName?}` | 201 `Member`；400 `invalid_member_request` / `invalid_group_ids`；409 `duplicate_email` 等 |
| PATCH | `/api/members/:memberId` | 调整成员角色、状态、分组或重置密码 | `{enabled,role,groupIds?,password?}` | `Member`；400 `invalid_member_id` / `invalid_member_request`；404 `not_found`；409 冲突 |
| DELETE | `/api/members/:memberId` | 删除成员，受最后管理员等保护 | 无 | 204；400 `invalid_member_id`；404 `not_found`；409 `cannot_delete_self`、`last_administrator`、`member_in_use` 等 |
| GET | `/api/members/pages` | 获取成员权限面板可配置的页面目录 | 无 | `{items: PageCatalog[]}`，供成员权限面板 |
| GET | `/api/members/display-name?exclude=名字1,名字2` | 为新成员建议未占用的展示名 | 可选逗号分隔的排除名单 | `{displayName}` |
| GET | `/api/members/groups` | 获取分组目录，供成员分组设置 | 无 | `{items:[{id,name}]}` |
| POST | `/api/members/groups` | 创建新的业务分组 | `{name}`：去空格后 1-80 字符 | 201 `{id,name}`；400 `invalid_group_request`；409 `duplicate_group_name` |
| GET | `/api/members/:memberId/permissions` | 读取该成员最终页面查看/删除权限 | 无 | `{items:[{key,canView,canDelete}]}`；400 `invalid_member_id`；404 `not_found` |
| PUT | `/api/members/:memberId/permissions` | 整体替换该成员页面权限 | `{pages:[{key,canView,canDelete},...]}`，1-200 项 | `{items:[...]}`；400 `invalid_member_permissions`；404/409 按冲突处理 |
| GET | `/api/audit` | 分页检索业务和权限审计日志 | 仅 WorkLogs 页面（管理员） | `{items,total,page,pageSize}`；400 `invalid_audit_filter` |

`Member` 返回 `{id,email,displayName,role,enabled,groupIds,createdAt}`，不返回登录
密码。创建时 `email` 必须合法，`role` 取上文七种值，`groupIds` 最多 100 个；可省略。
省略或传空数组时会被加入当前所有分组，不是“无分组”或最小权限。
`displayName` 可省略，由服务端生成（显式提供需 1-40 字符）。更新时 `enabled` 和
`role` 必填；`password` 可省略。页面权限采用 `PUT` 替换，不是增量 PATCH；管理员页
与工作日志页不可下放，概览不能开放删除。成员冲突码还可能包括
`cannot_configure_administrator`、`invalid_group_ids`。

审计可选查询参数：`action`（最多 160 字符）、`actorId`（UUID）、`target`（最多
320 字符）、`groupId`（UUID）、`createdAfter`、`createdBefore`（可解析日期），以及
`page`、`pageSize`。审计项含 `id,actorId,action,outcome,target,metadata,createdAt`；
`outcome` 为 `allowed|denied|failed`。

## 系统设置与私有云配置

两类配置接口只要求相应页面的 `canView`，不另查 `canDelete`；隐藏页面返回 404。

| 方法 | 路径 | 用途 | 权限 | 请求 | 成功响应 / 错误 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/settings/system` | 读取系统名称、任务策略和 webhook 配置状态 | Configuration | 无 | `{systemName,taskPolicy,notificationWebhookConfigured}` |
| PATCH | `/api/settings/system` | 修改系统设置，可选轮换 webhook 密钥 | Configuration | `{systemName,taskPolicy:{maxAttempts,retryDelaySeconds},notificationWebhookSecret?}` | 同 GET；400 `invalid_system_settings` |
| GET | `/api/storage/status` | 查询私有云当前配置和适配器健康状态 | Storage | 无 | `StorageStatus`；无权限返回 403 |
| GET | `/api/storage/configuration` | 读取私有云配置的公开字段 | Storage | 无 | `StorageStatus`；无权限返回 404 |
| PATCH | `/api/storage/configuration` | 保存私有云连接信息和可选凭据 | Storage | `{host,protocol,rootPath,credentials?}` | `StorageStatus`；400 `invalid_storage_configuration` |

设置：`systemName` 去空格后 1-120 字符；`taskPolicy.maxAttempts` 整数 1-10，
`retryDelaySeconds` 整数 1-86400；`notificationWebhookSecret` 可省略，若提供需
1-10000 字符。返回的 `notificationWebhookConfigured` 为布尔值，不含密钥。这里的
`taskPolicy` 是系统配置字段，**不是**提交执行任务时 `maxAttempts` 的自动覆盖值。

存储：`protocol` 为 `smb|nfs|webdav`；`host` 1-512 字符、`rootPath` 1-1024
字符；可选 `credentials:{username,password}`，不提供则保留旧凭据。返回
`StorageStatus={configuration:{host,protocol,rootPath}|null,credentialsConfigured:boolean,
state:"available"|"unavailable"|"unconfigured"}`，不含凭据。生产存储适配器
未配置时，不应把保存成功误认为 NAS 可读写。

## 注册资源

以下路径前缀为 `/api/groups/:groupId/registration-resources`，均要求精确
`StudioRegistration` 页面。`RR` 可预览、查看、导出；`RW` 可导入和重置，删除另需
`canDelete`。

| 方法 | 后缀 | 用途 | 权限 | 请求 | 成功响应 / 错误 |
| --- | --- | --- | --- | --- | --- |
| POST | `/import/preview` | 校验导入文本并显示去重/错误预览，不落库 | RR | `ImportBody` | 200 预览统计/错误，不入库；400 `invalid_import_request` |
| POST | `/imports` | 确认预览后批量入库并去重 | RW | `ImportBody` | 201 导入结果（含 created、duplicates 等）；400 `invalid_import_request` |
| GET | `/` | 查询本组注册凭据资源及筛选结果 | RR | `page,pageSize,query?,status?,tag?` | 分页列表；400 `invalid_list_request` |
| POST | `/batch/reset` | 将选中资源状态重置为待验证 | RW | `{ids:UUID[]}` | 重置结果；400 `invalid_batch_request` |
| POST | `/batch/delete` | 批量删除选中注册资源 | RW+删 | `{ids:UUID[]}` | 删除结果；400 `invalid_batch_request` |
| GET | `/export` | 下载本组资源的脱敏 CSV | RR | 无 | 200 脱敏 CSV，`Content-Type: text/csv; charset=utf-8`，不是 JSON |
| GET | `/statistics` | 汇总注册资源的标签数量 | RR | 无 | `{tags:[{tag,count}]}` |

`ImportBody={content:string,note?:string,tags?:string[]}`；`content` 长度 1-1000000，
`note` 最多 2000 字符，`tags` 最多 20 个且每项 1-64 字符。批量 `ids` 1-500 项。
预览响应为 `{duplicates:number,invalid:[{line,reason}],valid:[{line,kind,identifier,
metadata,state}]}`，其中 `state` 为 `duplicate|import`。确认导入响应为
`{created:RegistrationResource[],duplicates:number}`；重置和删除响应为 `{affected:number}`。
列表 `query` 最多 200 字符，`tag` 1-64 字符，`status` 仅
`unverified|ready|failed`。条目含 `id,groupId,kind,identifier,metadata,note,status,tags,
createdAt,updatedAt`；秘密字段和导出内容均脱敏。导入正文按资源解析器支持的格式
处理，前端应先调用 preview，再由用户确认后调用 imports。

`content` 是每行一条、字段间用 `----` 分隔的文本。支持
`邮箱----密码`（google-email）、`api-sms----供应商----token`、
`microsoft-oauth----邮箱----clientId----refreshToken`、
`pop3----邮箱----密码----host----port`。示例中的密码/token 必须由用户安全输入，
不得写进前端日志或 URL；预览只返回脱敏后的字段与无效行原因。

## 盒子、实例与直接设备命令

设备前缀为 `/api/groups/:groupId/devices`；均要求 `Devices` 页面。DR 查看，DW
创建、更新、提交或取消命令；物理删除另需页面删除权限。

| 方法 | 后缀 | 用途 | 权限 | 请求 | 成功响应 / 错误 |
| --- | --- | --- | --- | --- | --- |
| GET | `/` | 获取本组登记的盒子及实例，用于选择设备 | DR | 无 | `{items:Device[]}` |
| POST | `/` | 登记盒子元数据，不自动接入设备协议 | DW | `DeviceCreate` | 201 `Device`；400 `invalid_device_request`；409 `device_host_conflict` |
| GET | `/:deviceId` | 查看指定盒子元数据及实例 | DR | 无 | `Device`；404 `not_found` |
| GET | `/:deviceId/status` | 查看盒子及实例已保存的健康观测 | DR | 无 | 设备及实例观测状态；404 `not_found` |
| PATCH | `/:deviceId` | 修改盒子登记信息及启用状态 | DW | `DeviceUpdate` | `Device`；400 `invalid_device_request`；404/409 |
| DELETE | `/:deviceId` | 删除盒子及其实例，活跃占用时拒绝 | DW+删 | 无 | 204；404 `not_found`；409 `operation_entity_active` |
| POST | `/:deviceId/instances` | 在盒子下登记一个实例 | DW | `{index,label,enabled?}` | 201 `DeviceInstance`；400 `invalid_device_instance_request`；404/409 |
| PATCH | `/:deviceId/instances/:instanceId` | 修改实例编号、标签或启用状态 | DW | `{index?,label?,enabled?}` | `DeviceInstance`；400 `invalid_device_instance_request`；404/409 |
| DELETE | `/:deviceId/instances/:instanceId` | 删除实例，活跃占用时拒绝 | DW+删 | 无 | 204；404 `not_found`；409 `operation_entity_active` |
| POST | `/:deviceId/commands` | 持久化提交一条直接设备命令 | DW | `CommandCreate` | 201 新命令、200 相同幂等请求；400 `invalid_device_command_request`；404/409 |
| GET | `/:deviceId/commands` | 分页查看该设备的直接命令历史 | DR | `page,pageSize` | 命令分页列表；400 `invalid_page`；404 `not_found` |
| GET | `/:deviceId/commands/:commandId` | 查看单条命令的状态及安全结果 | DR | 无 | `CommandRecord`；404 `not_found` |
| POST | `/:deviceId/commands/:commandId/cancel` | 请求取消尚未完成的直接命令 | DW | 无 | `CommandRecord`；404 `not_found`；502 为适配器取消错误码 |

`DeviceCreate={bridge:boolean,host:string,model:string,name:string,resourceCount?:number,
version?:string|null}`。`host` 1-253 字符，`model,name` 各 1-128，`resourceCount`
默认 0、范围 0-100000，`version` 默认 null。`DeviceUpdate` 是上述字段的非空部分
更新，另可包含 `enabled:boolean`。`Device` 含 `id,groupId,name,host,model,bridge,
enabled,resourceCount,version,status,lastHealthAt,lastHealthFailure,instances,createdAt,
updatedAt`。设备状态为 `unknown|online|offline`；这是登记/观测状态，不代表实时监控。
实例 `index` 整数 1-24，`label` 1-128 字符，`enabled` 默认 true。

`CommandCreate` 需要 JSON 内的 `idempotencyKey`（1-256 字符），可选 `instanceId`
（UUID）及 `timeoutMs`（1-30000，默认 5000），并以 `type` 选择命令：

| `type` | 额外 JSON 字段 |
| --- | --- |
| `health_check`、`capture_screen` | 无 |
| `launch_app`、`stop_app` | `appId`：1-256 字符 |
| `tap` | `x,y`：有限非负数 |
| `swipe` | `fromX,fromY,toX,toY`：有限非负数；`durationMs`：正整数 |
| `input_text` | `text`：1-10000 字符；敏感输入，不要持久化在前端日志 |

例如：

```http
POST /api/groups/11111111-1111-4111-8111-111111111111/devices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/commands
Content-Type: application/json

{"type":"health_check","idempotencyKey":"device-check-001"}
```

`CommandRecord` 包含 `id,groupId,deviceId,instanceId,kind,status,parameters,
idempotencyKey,requesterId,timeoutMs,createdAt,startedAt,finishedAt,errorCode,
result,resultReference`，以及 `providerReceipt`、`attemptCount`、`cancelRequestedAt`
等字段；状态为 `queued|running|succeeded|failed|timed_out|cancelled`。不包含输入文本
原文。直接命令与下一节的执行任务
是两个独立接口；不能拿命令列表充当任务列表。未配置真实适配器时不能声称设备执行成功。

## 运营账号、账号池、代理与资源

运营账号前缀：`/api/groups/:groupId/operations/accounts`，需精确 `Accounts` 页面。

| 方法 | 后缀 | 用途 | 权限 | 请求 | 成功响应 / 错误 |
| --- | --- | --- | --- | --- | --- |
| GET | `/` | 分页筛选本组运营账号及画像 | OR | `AccountQuery` | 分页账号；400 `invalid_list_request` |
| GET | `/export` | 下载匹配筛选条件的脱敏账号 CSV | OR | 同 `AccountQuery`，忽略分页字段 | 200 脱敏 CSV，不是 JSON |
| POST | `/` | 创建运营账号并加密保存凭据 | OW | `AccountCreate` | 201 账号；400 `invalid_account_request` / `invalid_account_binding` |
| PATCH | `/:accountId` | 修改账号属性或更新秘密字段 | OW | `AccountUpdate` | 账号；400 `invalid_account_id` / `invalid_account_request` / `invalid_account_binding`；404 `not_found` |
| POST | `/recycle` | 将选中账号移入回收状态 | OW | `{ids:UUID[]}` | `{affected:number}`；400 `invalid_batch_request`；409 `operation_entity_active` |
| POST | `/restore` | 恢复已回收的账号 | OW | `{ids:UUID[]}` | `{affected:number}`；400 `invalid_batch_request` |
| POST | `/batch/tags` | 批量添加、替换或清空账号标签 | OW | `{ids:UUID[],mode:"add"|"replace"|"clear",tags?:string[]}` | `{affected:number}`；400 `invalid_batch_request` |
| POST | `/batch/proxy` | 批量绑定或清除账号代理 | OW | `{ids:UUID[],proxyId:UUID|null}` | `{affected:number}`；400 `invalid_batch_request` / `invalid_account_binding` |
| POST | `/batch/delete` | 永久删除选中账号，活跃占用时拒绝 | OW+删 | `{ids:UUID[]}` | `{affected:number}`；400 `invalid_batch_request`；409 `operation_entity_active` |

`AccountCreate` 字段：`identifier?`（最长 320，默认空）、`name?`（最长 160，未给
时由标识符/默认名生成）、`app?`（`tiktok|youtube|facebook|instagram|twitter|null`）、
`status?`（`ready|suspended|disabled`）、`backupType?`（`local|private_cloud|null`）、
`deviceId?`、`deviceInstanceId?`、`proxyId?`（UUID/null）、`region?`（最长 64）、
`note?`（最长 2000）、`tags?`（最多 20 项、每项 1-64）、`secret?` 和 `totp?`
（各最长 20000）。`AccountUpdate` 为对应字段的部分更新；凭据只写不回显，返回
`hasPassword`、`hasTotp`、`credentialState` 等标志。`AccountQuery` 支持
`page,pageSize,query,status,tag,app,backupType,deviceId,deleted,favorite,hasPassword,
hasProxy,hasTotp,noUsername,online`；布尔查询只能写字符串 `true` 或 `false`。
批量 `ids` 1-500 项。`recycle` 是回收动作，不等于物理删除。

账号池前缀：`/api/groups/:groupId/operations/account-pool`，需 `AccountPool` 页面。

| 方法 | 后缀 | 用途 | 权限 | 请求 | 成功响应 / 错误 |
| --- | --- | --- | --- | --- | --- |
| GET | `/` | 查看账号及其当前租用者/有效租约 | OR | 无 | `{items:AccountPoolItem[]}` |
| POST | `/:accountId/leases` | 独占租用一个可用运营账号 | OW | `{expiresAt?: ISO 日期}` | 201 租约；400 `invalid_account_id` / `invalid_lease_request`；409 `account_lease_conflict` |
| DELETE | `/:accountId/leases` | 释放自己的租约，管理员可回收他人租约 | OW | 无 | 204；400 `invalid_account_id`；404 `not_found` |

`AccountPoolItem={account:OperationAccount,activeLease:AccountLease|null}`；
`AccountLease={id,accountId,groupId,leasedByUserId,createdAt,expiresAt,releasedAt}`。
当前账号池返回的 `account` 部分字段为占位投影，不应拿它覆盖账号列表的完整画像。
租用要求同组、`ready` 且未回收的账号；请求体必须是 JSON 对象，即使不设置到期时间
也要发送 `{}`。

代理前缀：`/api/groups/:groupId/operations/proxies`，需 `Proxies` 页面。创建/更新中的
`credentials` 加密保存，不随响应回传。

| 方法 | 后缀 | 用途 | 权限 | 请求 | 成功响应 / 错误 |
| --- | --- | --- | --- | --- | --- |
| GET | `/` | 分页检索本组代理端点及状态 | OR | `page,pageSize,query?,status?,tag?` | 分页代理；400 `invalid_list_request` |
| POST | `/` | 登记代理并加密保存认证信息 | OW | `{credentials,endpoint,name,note?,status?,tags?}` | 201 代理；400 `invalid_proxy_request` |
| PATCH | `/:proxyId` | 编辑代理端点、状态或更新凭据 | OW | 上述字段的部分更新 | 代理；400 `invalid_proxy_id` / `invalid_proxy_request`；404 `not_found` |
| POST | `/batch/delete` | 批量删除代理，活跃占用时拒绝 | OW+删 | `{ids:UUID[]}` | `{affected:number}`；400 `invalid_batch_request`；409 `operation_entity_active` |

代理 `endpoint` 长度 3-320、`name` 1-160、`credentials` 1-20000，`status` 为
`ready|unavailable|disabled`，`note` 最长 2000，`tags` 最多 20 项（每项 1-64）。

运营资源前缀：`/api/groups/:groupId/operations/resources`，目前绑定的是
`StudioTextPool` 页面而非旧“运营资源”页。需 OR/OW；物理删除另需页面删除权限。

| 方法 | 后缀 | 用途 | 权限 | 请求 | 成功响应 / 错误 |
| --- | --- | --- | --- | --- | --- |
| GET | `/` | 分页筛选本组运营资源台账（含各状态） | OR | `page,pageSize,query?,status?,tag?` | 分页资源；400 `invalid_list_request` |
| POST | `/` | 新建运营资源条目 | OW | `{category,name,note?,status?,tags?}` | 201 资源；400 `invalid_resource_request` |
| PATCH | `/:resourceId` | 修改资源资料或可用状态 | OW | 上述字段的部分更新 | 资源；400 `invalid_resource_id` / `invalid_resource_request`；404 `not_found`；409 `resource_allocation_active` |
| POST | `/batch/delete` | 批量删除资源，活跃分配时拒绝 | OW+删 | `{ids:UUID[]}` | `{affected:number}`；400 `invalid_batch_request`；409 `operation_entity_active` |
| GET | `/:resourceId/allocations` | 查看该资源分配/释放历史 | OR | 无 | `{items:ResourceAllocation[]}`；400 `invalid_resource_id` |
| POST | `/:resourceId/allocations` | 将可用资源分配给同组账号 | OW | `{accountId:UUID}` | 201 分配；400 `invalid_resource_id` / `invalid_allocation_request`；409 `allocation_conflict` |
| DELETE | `/:resourceId/allocations` | 释放该资源的活跃分配 | OW | 无 | 204；400 `invalid_resource_id`；404 `not_found` |

资源 `category` 1-80、`name` 1-160、`note` 最长 2000、`tags` 最多 20 项（每项
1-64）。创建 `status` 可省略（默认 `available`）或为 `inactive`；读取中可能为
`available|allocated|inactive`。分配时目标账号必须在同组且存在；资源本身需处于
`available`，且不能已有活跃分配。

## 执行任务

任务前缀：`/api/groups/:groupId/tasks`。需要 `Tasks` 页面；读接口 OR，写接口 OW。
不是上文设备直接命令接口，也不是前端当前的本地脚本任务页。

| 方法 | 后缀 | 用途 | 权限 | 请求 | 成功响应 / 错误 |
| --- | --- | --- | --- | --- | --- |
| POST | `/` | 持久化一项按顺序执行设备命令的任务 | OW | `Idempotency-Key` 头 + `{name,executorKey:"device-command",steps,parameters?,maxAttempts?}` | 202 新任务，200 等价重放；400 `idempotency_key_required` / `invalid_task_request`；404 目标不存在；409 `execution_task_idempotency_conflict` |
| GET | `/` | 分页查询本组任务状态和步骤摘要 | OR | `page,pageSize` | 分页安全任务；400 `invalid_page` |
| GET | `/:taskId` | 查看单项任务及有序步骤的当前状态 | OR | 无 | 安全任务详情；404 `not_found` |
| POST | `/:taskId/cancel` | 请求停止待执行或执行中的任务 | OW | 无 | 200 当前任务；404 `not_found` |
| POST | `/:taskId/reconcile` | 管理员核实外部结果后处理待复核任务 | 管理员 + OW + Tasks + 显式分组成员 | `{resolution:"succeeded"|"failed"|"cancelled",evidenceRef}` | 200 `{taskId,state}`；400 `invalid_reconciliation`；404 `not_found`；409 `reconciliation_conflict` |

单任务步骤 1-100 条，全部同一设备和实例；`parameters` 只能省略或 `{}`；
`maxAttempts` 默认 3，允许 1-10；`input_text` 暂不支持。列表/详情只返回安全状态，
不返回步骤结果、错误文本或截图。**202 是持久化入队，不是物理执行成功**。
完整请求实例、状态、复核约束见[任务执行前端对接](任务执行前端对接.md)。
