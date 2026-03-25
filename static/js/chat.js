// 建立带token的Socket连接
const socket = io();

let lastMessageId = 0;
let lastDividerTimeMs = null;
const TIME_DIVIDER_THRESHOLD_MS = 5 * 60 * 1000;

// 更新在线状态指示灯
function updateOnlineStatus(status) {
    const indicator = document.querySelector(".online-indicator");
    if (indicator) {
        if (status === "connected") {
            indicator.classList.remove("offline");
        } else {
            indicator.classList.add("offline");
        }
    }

    // 更新输入框和发送按钮状态
    sendButton.disabled = status === "disconnected";
}

// 处理强制下线事件
socket.on("force_disconnect", function (data) {
    socket.disconnect();

    // 更新状态指示灯
    updateOnlineStatus("disconnected");

    // 延迟跳转到登录页面
    setTimeout(() => {
        window.location.href = "/login";
    }, 1000);
});

// Socket连接事件
socket.on("connect", () => {
    updateOnlineStatus("connected");
});

socket.on("disconnect", () => {
    updateOnlineStatus("disconnected");
});

// 消息容器
const messagesContainer = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");

// 发送消息
function sendMessage() {
    const message = sanitizeMessage(messageInput.value.trim());
    if (message) {
        socket.emit("send_message", { message: message });
        messageInput.value = "";
    }
}

// 自动滚动到最新消息
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 接收消息
socket.on("message", function (data) {
    if (typeof data.id === "number" && data.id <= lastMessageId) {
        return;
    }
    // 转换UTC时间为本地时间
    const utc_timestamp = new Date(data.timestamp);
    const date = new Date(
        utc_timestamp.getTime() - utc_timestamp.getTimezoneOffset() * 60 * 1000,
    );
    const transformed_timestamp = date
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

    const currentTimeMs = Number.isNaN(date.getTime()) ? null : date.getTime();
    if (currentTimeMs !== null) {
        if (lastDividerTimeMs === null) {
            appendTimeDivider(currentTimeMs);
            lastDividerTimeMs = currentTimeMs;
        } else if (
            currentTimeMs - lastDividerTimeMs >=
            TIME_DIVIDER_THRESHOLD_MS
        ) {
            appendTimeDivider(currentTimeMs);
            lastDividerTimeMs = currentTimeMs;
        }
    }

    const isOwn = data.username === username;
    const avatarUrl = resolveAvatarUrl(
        data.avatar_url || (isOwn ? currentUserAvatar : ""),
        data.username,
    );

    const messageElement = document.createElement("div");
    messageElement.className = `message-row ${isOwn ? "own-row" : "other-row"}`;
    messageElement.innerHTML = messageContent({
        isOwn,
        avatarUrl,
        transformed_timestamp,
        data,
    });
    messagesContainer.appendChild(messageElement);

    if (typeof data.id === "number") {
        lastMessageId = data.id;
    }
    scrollToBottom();

    function messageContent({ isOwn, avatarUrl, transformed_timestamp, data }) {
        const timeHtml = `<span class="timestamp">${transformed_timestamp}</span>`;
        const nameHtml = `<span class="username">${sanitizeMessage(data.username)}</span>`;

        return `
            ${isOwn ? "" : `<img class=\"message-avatar\" src=\"${avatarUrl}\" alt=\"${sanitizeMessage(data.username)}头像\">`}
            <div class="message-main">
                <div class="message-meta">
                    ${isOwn ? `${timeHtml}${nameHtml}` : `${nameHtml}${timeHtml}`}
                </div>
                <div class="message-bubble">
                    <p class="content">${sanitizeMessage(data.message)}</p>
                </div>
            </div>
            ${isOwn ? `<img class=\"message-avatar\" src=\"${avatarUrl}\" alt=\"${sanitizeMessage(data.username)}头像\">` : ""}
        `;
    }
});

// 监听事件
sendButton.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", function (event) {
    if (event.key === "Enter" && !sendButton.disabled) {
        sendMessage();
    }
});

// 定期检查新消息
setInterval(() => {
    socket.emit("check_messages", { lastId: lastMessageId });
}, 5000);

// 初始加载完成后滚动到底部
window.onload = function () {
    scrollToBottom();
};

/* --- MISCS FOR MESSAGE DISPLAY --- */

function sanitizeMessage(message) {
    const tempElement = document.createElement("div");
    tempElement.textContent = message;
    return tempElement.innerText;
}

function resolveAvatarUrl(avatarUrl, userName) {
    if (avatarUrl) {
        return avatarUrl;
    }

    return defaultAvatarUrl;
}

function formatDividerTime(date) {
    return date
        .toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        })
        .replace(/\//g, "-");
}

function appendTimeDivider(timeMs) {
    const dividerElement = document.createElement("div");
    dividerElement.className = "time-divider";
    dividerElement.textContent = formatDividerTime(new Date(timeMs));
    messagesContainer.appendChild(dividerElement);
}
