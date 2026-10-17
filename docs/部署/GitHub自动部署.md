# GitHub 自动部署与 IP 访问

仓库为 `IMUTD/tk-mg-sys`，目标服务器为 Ubuntu 22.04、x86_64，已安装 Docker 和 Compose。部署包含前端、API、Worker、PostgreSQL 和 Redis，入口为 `http://服务器IP:8080/login`。生产环境配置和数据保存在服务器上。

## 分支与触发条件

`feat/github-deploy-test` 和 `main` 的推送会触发 `.github/workflows/deploy.yml`：部署验证、后端单元测试、真实 PostgreSQL 初始化测试通过后，构建三个 `linux/amd64` 镜像并推送 GHCR。

测试分支只检查本次部署涉及的 TypeScript 文件；现有全量 lint 和类型检查在当前主分支已有失败，不降低原测试断言。原 CI 增加可复用调用入口，保留原触发条件和所有检查；`main` 的部署等待完整 CI 成功，包括 lint、类型检查、前端单元测试、PostgreSQL 集成测试和浏览器测试。此测试分支用于部署验收，不能代替项目完整质量验收。

服务器部署还要求仓库变量 `DEPLOY_ENABLED=true`。未设置时只验证和构建镜像，不连接服务器。首次测试直接通过推送测试分支触发：GitHub 要求工作流先存在于默认分支，才能使用 `workflow_dispatch` 手动运行。合入主分支后可在 Actions 的 Deploy 页面选择分支手动运行。

镜像名称为：

```text
ghcr.io/imutd/tk-mg-sys-api:sha-完整提交SHA
ghcr.io/imutd/tk-mg-sys-worker:sha-完整提交SHA
ghcr.io/imutd/tk-mg-sys-web:sha-完整提交SHA
```

使用仓库内置 `GITHUB_TOKEN` 发布和拉取本仓库关联镜像，工作流为镜像设置源码仓库标签。服务器登录凭证仅在部署期间存入发布目录的临时 Docker 配置，结束后清理。组织需要允许该仓库创建 GHCR 包；已有同名包需要授予本仓库 Actions 读取和写入权限。

## 一次性配置

在本机生成专用 SSH 密钥，把公钥加入服务器部署用户的 `~/.ssh/authorized_keys`。部署用户需要能执行 Docker，且能写入部署目录。当前服务器使用 root 时可将 `DEPLOY_USER` 设置为 `root`。

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tk-mg-deploy -C github-actions-tk-mg -N ''
ssh-copy-id -i ~/.ssh/tk-mg-deploy.pub -p 22 root@服务器IP
ssh-keyscan -p 22 -t ed25519 服务器IP
```

核对扫描结果的指纹与服务器上的主机公钥指纹一致，再保存为 `DEPLOY_KNOWN_HOSTS`。服务器上查看指纹：

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

仓库管理员在 Settings → Secrets and variables → Actions 配置下列 Secrets。私钥填密钥文件完整内容，不在聊天、代码或日志里传递。

| Secret | 内容 |
| --- | --- |
| `DEPLOY_HOST` | 服务器公网 IPv4 或主机名 |
| `DEPLOY_USER` | SSH 用户 |
| `DEPLOY_SSH_KEY` | 专用 SSH 私钥 |
| `DEPLOY_KNOWN_HOSTS` | 已核对的主机公钥记录，非 22 端口需包含端口 |

仓库 Variables：

| Variable | 默认值与用途 |
| --- | --- |
| `DEPLOY_ENABLED` | 设置为 `true` 才连接服务器 |
| `DEPLOY_PORT` | SSH 端口，默认 `22` |
| `DEPLOY_PATH` | 默认 `/opt/tk-mg-sys`，绝对路径，只使用字母、数字、下划线、连字符和斜杠 |
| `DEPLOY_WEB_PORT` | 首次生成配置时的访问端口，默认 `8080` |
| `ADMIN_EMAIL` | 首次管理员邮箱，默认 `admin@example.internal` |

在云服务器安全组和主机防火墙放行 SSH 端口、Web 端口；测试期间可限制来源 IP。PostgreSQL、Redis 和 API 不映射宿主机端口。

## 首次部署

配置完成后推送测试分支。工作流上传当前提交里的 `infra` 文件，首次自动生成 `/opt/tk-mg-sys/shared/.env`，权限为 `600`。数据库密码、Redis 密码、管理员密码和 32 字节加密密钥在服务器随机生成，不输出到 Actions 日志；再次部署保留该文件。

启动顺序为：

1. 拉取当前提交对应的全部镜像。
2. 启动并等待 PostgreSQL、Redis 健康。
3. 执行已有 Drizzle 增量迁移。
4. 在事务中创建登录管理员和独立的禁用系统账号。重试时不覆盖已有密码或权限，身份冲突时失败。
5. 启动 API、Worker、前端，并等待各自健康检查。
6. 检查数据库、Redis、API readiness、前端以及经 Nginx 访问的会话接口。
7. 所有检查通过后写入成功版本记录。

不会自动导入 `docs/public.sql` 或 `docs/dump.rdb`，不会连接初始化器数据库，也不会启用可选的初始化器同步服务。

首次成功后，在服务器本地查看管理员信息：

```bash
grep '^ADMIN_BOOTSTRAP_EMAIL=' /opt/tk-mg-sys/shared/.env
grep '^ADMIN_BOOTSTRAP_PASSWORD=' /opt/tk-mg-sys/shared/.env
```

浏览器打开 `http://服务器IP:8080/login`，登录后刷新，确认仍然登录；退出后刷新，应回到登录页。

本次采用 HTTP IP 访问，生成配置显式设置 `AUTH_COOKIE_SECURE=false`，保留 `HttpOnly` 和 `SameSite=Strict`。HTTP 登录流量没有 TLS 加密。切换 HTTPS 后将该变量改为 `true` 再部署；API 未配置此变量时默认使用 Secure Cookie。

修改已有部署的端口需编辑服务器 `shared/.env` 中的 `WEB_PORT`；修改 GitHub 的 `DEPLOY_WEB_PORT` 不会覆盖已有服务器配置。

## 更新与回退

服务器目录：

```text
/opt/tk-mg-sys/
  shared/.env
  releases/sha-完整提交SHA/infra/
  backups/时间戳-sha-完整提交SHA.dump
  current-release
  previous-release
  pending-release
  deploy.lock
```

Compose 项目名固定为 `tk-mg`，数据卷为 `tk-mg_postgres-data` 和 `tk-mg_redis-data`。发布目录变化不改变项目名和数据卷。每次更新先拉取镜像，再通过 `pg_dump -Fc` 备份业务数据库，停止应用，迁移并启动新版本。单机更新存在短暂中断。

失败不会覆盖成功版本记录，也不会自动恢复数据库。若迁移或启动失败，应用可能已停止，需要在服务器诊断或手动回退。不要执行 `docker compose down -v`。

读取最后成功版本并查看状态：

```bash
export IMAGE_TAG=$(cat /opt/tk-mg-sys/current-release)
docker compose --env-file /opt/tk-mg-sys/shared/.env \
  -f /opt/tk-mg-sys/releases/$IMAGE_TAG/infra/compose.prod.yml ps
```

发生失败发布时，回退脚本恢复 `current-release` 记录的最近成功版本；正常撤销一次成功发布时恢复 `previous-release`：

```bash
bash /opt/tk-mg-sys/releases/$IMAGE_TAG/infra/rollback.sh /opt/tk-mg-sys
```

手动回退复用服务器保留的镜像，禁止自动拉取，不依赖已过期的工作流令牌。不要在验收前清理旧镜像。若旧镜像已被清理，先通过拥有本仓库包读取权限的 GitHub 账号及 `read:packages` 凭证执行 `docker login ghcr.io`，使用目标发布目录的 Compose 配置手动拉取对应版本，再运行回退脚本，结束后可 `docker logout ghcr.io`。回退只恢复应用镜像，不执行旧迁移、不恢复数据库。必须确认旧代码兼容当前数据库结构；不兼容时应修复后发布，或在停止写入后按备份恢复方案操作。

如果新版本在首次成功前失败，没有可用的上一版本记录，可直接使用已知成功发布目录中的 `infra/deploy.sh`，传入对应的 `sha-完整提交SHA` 和 `--rollback` 恢复。首次全新部署失败则修复原因后重试同一版本。

Worker 默认使用仓库现有的未配置设备适配器。服务部署和软件登录验收不代表真实盒子、RPA、NAS 或初始化器已接入。

## 本地验证命令

```bash
bash infra/deploy.test.sh
bash infra/smoke-test.test.sh
actionlint .github/workflows/deploy.yml
bun test apps/api/src/main.test.ts apps/api/src/modules/auth/routes-cookie.test.ts
```

初始化数据库测试必须设置 `TEST_DATABASE_URL`，数据库名必须以 `tk_mg_test_` 开头；测试会重建该数据库的 schema。不要使用业务数据库连接。
