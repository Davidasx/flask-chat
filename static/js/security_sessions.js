const securitySessionsBody = document.getElementById("security-sessions-body");

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

async function kickSession(token) {
    try {
        const response = await fetch("/security/sessions/kick", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        });
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || "强制下线失败");
            return;
        }
        showSuccess(data.message || "会话已下线");
        await loadSecuritySessions();
    } catch {
        showError("请求失败，请稍后再试");
    }
}

function renderSessions(items) {
    securitySessionsBody.innerHTML = "";

    items.forEach((item) => {
        const row = document.createElement("tr");

        const stateCell = document.createElement("td");
        stateCell.textContent = item.is_current ? "当前设备" : "其他设备";
        stateCell.className = item.is_current ? "state-current" : "state-other";
        row.appendChild(stateCell);

        const ipCell = document.createElement("td");
        ipCell.textContent = safeText(item.ip_address || "-");
        row.appendChild(ipCell);

        const uaCell = document.createElement("td");
        uaCell.textContent = safeText(item.user_agent || "-");
        row.appendChild(uaCell);

        const createdCell = document.createElement("td");
        createdCell.textContent = formatDate(item.created_at);
        row.appendChild(createdCell);

        const activeCell = document.createElement("td");
        activeCell.textContent = formatDate(item.last_seen);
        row.appendChild(activeCell);

        const actionCell = document.createElement("td");
        if (item.is_current) {
            actionCell.textContent = "-";
        } else {
            const kickBtn = document.createElement("button");
            kickBtn.className = "danger-btn";
            kickBtn.textContent = "强制下线";
            kickBtn.addEventListener("click", () => kickSession(item.token));
            actionCell.appendChild(kickBtn);
        }
        row.appendChild(actionCell);

        securitySessionsBody.appendChild(row);
    });
}

async function loadSecuritySessions() {
    try {
        const response = await fetch("/security/sessions/list");
        const data = await response.json();
        if (!response.ok) {
            showError(data.error || "加载会话失败");
            return;
        }
        renderSessions(data.sessions || []);
    } catch {
        showError("加载会话失败");
    }
}

loadSecuritySessions();
setInterval(loadSecuritySessions, 15000);
