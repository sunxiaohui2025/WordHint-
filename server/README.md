# WordHint Cloud

公网同步、用户审批、用量统计和 LLM 代理服务。Chrome 与 iOS 均只连接该服务，客户端仍保留本地数据，因此离线可学习，恢复网络后手动双向同步。

## 本地启动

```bash
cd server
cp .env.example .env
# 修改 .env，尤其是管理员密码与 WORDHINT_SECRET
docker compose up -d --build
```

- 健康检查：`http://127.0.0.1:8000/health`
- 管理台：`http://127.0.0.1:8000/admin`
- OpenAPI：`http://127.0.0.1:8000/docs`

## Linux 原生部署（只需本目录）

将整个 `server` 目录上传到服务器，例如 `/opt/wordhint/server`。目录中必须保留 `app/`、`requirements.txt`、`.env.example` 和脚本；不需要上传 `wordhint/` Chrome 插件或 `WordHintIOS/`。

```bash
cd /opt/wordhint/server
chmod +x install.sh start.sh backup.sh
./install.sh
vim .env                         # 填写生产密钥、管理员账号、LLM 地址
./start.sh                       # 临时前台运行
curl http://127.0.0.1:8000/health
```

生产环境建议使用 systemd：

```bash
sudo useradd --system --home /opt/wordhint --shell /usr/sbin/nologin wordhint
sudo chown -R wordhint:wordhint /opt/wordhint/server
sudo cp wordhint.service.example /etc/systemd/system/wordhint.service
sudo systemctl daemon-reload
sudo systemctl enable --now wordhint
sudo systemctl status wordhint
```

systemd 示例默认监听 `127.0.0.1:8000`，再由 Nginx/Caddy 提供 HTTPS 反向代理。服务器防火墙只开放 80/443，不要直接暴露 8000 或 vLLM 端口。

数据库备份：

```bash
./backup.sh /var/backups/wordhint
```

建议通过 cron 每日执行，并保留最近 7～30 天备份。`WORDHINT_DATABASE` 的父目录会在启动时自动创建。

## 公网部署

在 Docker 前放置 Caddy 或 Nginx，用域名申请 HTTPS 证书，并把请求反向代理至 `127.0.0.1:8000`。防火墙只公开 80/443，不公开 8000 和 vLLM 端口。将 Chrome 插件和 iOS 登录页中的服务器地址设置为 `https://你的域名`。

Docker 部署仍然只需要本目录：

```bash
cp .env.example .env
chmod 600 .env
docker compose up -d --build
docker compose logs -f wordhint
```

`.env` 不会被 Dockerfile 打包进镜像，数据库保存在 Docker volume 中。

首次启动会根据 `WORDHINT_ADMIN_EMAIL` 和 `WORDHINT_ADMIN_PASSWORD` 创建管理员。普通用户注册后的状态为 `pending`，管理员在 `/admin` 批准后才能登录。

生产环境建议定期备份 `/data/wordhint.db`。用户规模扩大后可将当前 SQLite 数据访问层迁移到 PostgreSQL；API 和客户端数据结构无需改变。
