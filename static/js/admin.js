const runtimeStatusElement = document.getElementById("runtime-status");
const usersTableBody = document.getElementById("users-table-body");
const sessionsTableBody = document.getElementById("sessions-table-body");
let runtimeUptimeSeconds = 0;
let runtimeUptimeTimer = null;

function safeText(value) {
    if (typeof value === "string") {
        return value;
    }
    if (value === null || value === undefined) {
        return "";
    }
    return String(value);
}

function formatDate(value) {
    if (!value) {
        return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return safeText(value);
    }
    return date
        .toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        })
        .replace(/\//g, "-");
}

function formatUptime(seconds) {
    const total = Number(seconds) || 0;
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${d}天 ${h}小时 ${m}分 ${s}秒`;
}

function renderRuntime(runtime) {
    runtimeUptimeSeconds = Number(runtime.uptime_seconds) || 0;
    runtimeStatusElement.innerHTML = "";
    const pairs = [
        ["版本", safeText(runtime.app_version)],
        ["运行时长", formatUptime(runtime.uptime_seconds)],
        ["在线WebSocket", safeText(runtime.active_ws_connections)],
        ["注册用户总数", safeText(runtime.registered_users)],
    ];

    pairs.forEach(([label, value], index) => {
        const item = document.createElement("div");
        item.className = "status-item";
        if (index === 1) {
            item.dataset.runtimeKey = "uptime";
        }
        item.innerHTML = `<strong>${label}</strong><span>${value}</span>`;
        runtimeStatusElement.appendChild(item);
    });

    if (!runtimeUptimeTimer) {
        runtimeUptimeTimer = setInterval(() => {
            runtimeUptimeSeconds += 1;
            const uptimeElement = runtimeStatusElement.querySelector(
                '[data-runtime-key="uptime"] span',
            );
            if (uptimeElement) {
                uptimeElement.textContent = formatUptime(runtimeUptimeSeconds);
            }
        }, 1000);
    }
}

function createAdminButton(user) {
    const button = document.createElement("button");
    button.textContent = user.is_admin ? "取消管理员" : "设为管理员";
    button.className = "secondary-btn";
    button.addEventListener("click", async () => {
        try {
            const response = await fetch("/admin/api/set-admin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username: user.username,
                    is_admin: !user.is_admin,
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                showError(data.error || "操作失败");
                return;
            }
            showSuccess(data.message || "更新成功");
            await loadAdminData();
        } catch {
            showError("请求失败，请稍后再试");
        }
    });
    return button;
}

function renderUsers(users) {
    usersTableBody.innerHTML = "";

    users.forEach((user) => {
        const row = document.createElement("tr");

        const usernameCell = document.createElement("td");
        usernameCell.textContent = safeText(user.username);
        row.appendChild(usernameCell);

        const emailCell = document.createElement("td");
        emailCell.textContent = safeText(user.email || "-");
        row.appendChild(emailCell);

        const adminCell = document.createElement("td");
        adminCell.textContent = user.is_admin ? "是" : "否";
        adminCell.className = user.is_admin ? "state-admin" : "";
        row.appendChild(adminCell);

        const sessionCell = document.createElement("td");
        sessionCell.textContent = safeText(user.session_count || 0);
        row.appendChild(sessionCell);

        const createdCell = document.createElement("td");
        createdCell.textContent = formatDate(user.created_at);
        row.appendChild(createdCell);

        const actionCell = document.createElement("td");
        actionCell.appendChild(createAdminButton(user));
        row.appendChild(actionCell);

        usersTableBody.appendChild(row);
    });
}

function renderSessions(sessions) {
    sessionsTableBody.innerHTML = "";

    sessions.forEach((session) => {
        const row = document.createElement("tr");

        const usernameCell = document.createElement("td");
        usernameCell.textContent = safeText(session.username);
        row.appendChild(usernameCell);

        const ipCell = document.createElement("td");
        ipCell.textContent = safeText(session.ip_address || "-");
        row.appendChild(ipCell);

        const uaCell = document.createElement("td");
        uaCell.textContent = safeText(session.user_agent || "-");
        row.appendChild(uaCell);

        const activeCell = document.createElement("td");
        activeCell.textContent = formatDate(session.last_seen);
        row.appendChild(activeCell);

        const actionCell = document.createElement("td");
        const kickBtn = document.createElement("button");
        kickBtn.className = "danger-btn";
        kickBtn.textContent = "强制下线";
        kickBtn.addEventListener("click", async () => {
            try {
                const response = await fetch("/admin/api/kick-session", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token: session.token }),
                });
                const data = await response.json();
                if (!response.ok) {
                    showError(data.error || "强制下线失败");
                    return;
                }
                showSuccess(data.message || "会话已下线");
                await loadAdminData();
            } catch {
                showError("请求失败，请稍后再试");
            }
        });
        actionCell.appendChild(kickBtn);
        row.appendChild(actionCell);

        sessionsTableBody.appendChild(row);
    });
}

async function loadAdminData() {
    try {
        const response = await fetch("/admin/api/summary");
        const data = await response.json();

        if (!response.ok) {
            showError(data.error || "加载失败");
            return;
        }

        renderRuntime(data.runtime || {});
        renderUsers(data.users || []);
        renderSessions(data.sessions || []);
    } catch {
        showError("加载管理员数据失败");
    }
}

loadAdminData();
setInterval(loadAdminData, 15000);
