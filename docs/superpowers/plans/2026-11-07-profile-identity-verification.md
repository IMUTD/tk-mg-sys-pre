# 个人资料中的实名认证

**目标：** 按用户要求，将个人实名认证归入个人资料；未认证时可上传身份证，认证后只显示“已认证”，不再提供独立的个人实名认证菜单。

**设计：** 头像菜单中的“个人设置”弹窗升级为 `/profile` 个人资料页，保留名字、角色并显示当前登录邮箱。复用现有身份证上传、授权同意、状态轮询和错误提示。平台实名认证管理及后端认证范围、解绑、敏感信息存储均不变。

**技术栈：** React、Ant Design、React Router、TanStack Query、Vitest、Playwright。

## 行为约定

- 头像菜单“个人资料”打开 `/profile`，侧栏不增加个人资料或个人实名认证菜单。
- `/identity-verification` 兼容跳转至 `/profile`。
- 强制认证的管理员访问业务路由时跳转 `/profile`，继续使用无业务菜单的受限布局。
- 核验成功后刷新会话，停留在个人资料，显示“已认证”，隐藏上传表单和原“进入系统”按钮。
- 轮询确认成功、刷新后已认证和同步提交成功使用同样的状态刷新逻辑。
- 无需认证的账号显示“无需认证”，功能关闭时显示“暂未开放”，不误报已认证。

## 执行步骤

- [x] 更新 `apps/web/src/features/identity-verification/page.test.tsx`，先验证已认证展示与异步成功刷新；新增 `apps/web/src/features/profile/page.test.tsx` 覆盖资料入口、旧链接、强制认证、豁免状态。
- [x] 新增 `apps/web/src/features/profile/page.tsx`，迁移 `components/layout/account-menu.tsx` 的个人资料内容；修改 `app/router.tsx`、`components/layout/admin-shell.tsx`、`components/layout/protected-route.tsx`、`features/identity-verification/route.tsx` 和 `required-layout.tsx` 完成入口与跳转。
- [x] 调整 `features/identity-verification/page.tsx` 为资料页中的认证卡片，核验成功时同步会话，并隐藏已认证用户的操作和证件详情。
- [x] 更新真实集成场景的路径和成功后断言；新增浏览器场景覆盖资料菜单、上传成功停留、旧链接、强制认证以及桌面/移动端显示。
- [x] 运行 `pnpm --filter @tk-mg/web test`、`pnpm typecheck`、`pnpm lint` 和相应 Playwright 场景；全量前端回归单进程复跑 200 项通过。构建前端，让当前本地 nginx 服务提供新页面。
- [x] 检查桌面、移动端与深色模式截图，核对本地真实会话下的资料页面。测试中的合成照片仅用于拦截 API 的浏览器测试，不向阿里云提交。

## 交付约束

本次使用已有 `feat/admin-identity-verification` 工作树。无数据库变更，不修改本地阿里云配置。完成验收后，用户已明确授权提交；按该指令提交本轮改动，不推送。
