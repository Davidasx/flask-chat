# README.md

# Flask Chat Room

这是一个使用Flask框架构建的公开聊天室应用程序。用户可以通过该应用程序进行实时聊天。

## 主要功能

- 用户注册和登录
- 邮箱验证注册(可选)
- 修改密码
- 实时聊天
- 历史消息查看

## 快速开始

1. 安装依赖：

```bash
pip install -r requirements.txt
```

2. 配置文件：

```bash
cp config.json.template config.json
```

说明：`config.json` 中的 `server` 段为可选项，仅在 `python app.py` 开发启动时读取；使用 `gunicorn` 时不依赖该段。

## 配置文件说明

项目通过根目录下的 `config.json` 读取配置。

### 配置项

- `database`：SQLite 数据库文件路径（默认 `chat.db`）
- `email_verification`：是否启用邮箱验证注册（`true/false`）
- `verification_sender.resend_api_key`：Resend API Key（启用邮箱验证时必填）
- `verification_sender.sender_email`：发件人邮箱（启用邮箱验证时必填）
- `verification_sender.recipient_domain`：限制可注册邮箱域名；`*` 表示不限制
- `secret_key`：Flask 会话与 JWT 使用的密钥（建议使用高强度随机字符串）
- `site_name`：站点名称（显示在页面标题和导航栏）
- `server`（可选）：仅 `python app.py` 开发模式读取，生产 `gunicorn` 不依赖

### 示例

```json
{
    "database": "chat.db",
    "email_verification": false,
    "verification_sender": {
        "resend_api_key": "",
        "sender_email": "user@example.com",
        "recipient_domain": "*"
    },
    "secret_key": "secret-key-here",
    "site_name": "Chat App",
    "server": {
        "host": "0.0.0.0",
        "port": 5000,
        "debug": true
    }
}
```

3. 启动服务（默认方式，推荐）：

```bash
gunicorn --worker-class gthread --threads 8 -w 1 -b 0.0.0.0:5000 app:app
```

## 开发模式

本地开发可直接运行：

```bash
python app.py
```
