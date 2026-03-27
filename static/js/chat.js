// 建立带token的Socket连接
const socket = io();

let lastMessageId = 0;
let lastDividerTimeMs = null;
let activeMessageMenu = null;
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

function isCoarsePointerDevice() {
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

function isMessageManageable(data) {
    const isOwn = data.username === username;
    const fromAdmin = Boolean(data.is_admin);
    return isOwn || (userIsAdmin && !fromAdmin);
}

function closeActiveMessageMenu() {
    if (activeMessageMenu) {
        activeMessageMenu.classList.remove("open");
        activeMessageMenu = null;
    }
}

function clearVisibleMessageActions(exceptRow = null) {
    document.querySelectorAll(".message-row.actions-visible").forEach((row) => {
        if (row !== exceptRow) {
            row.classList.remove("actions-visible");
        }
    });
}

function clearVisibleMessageMeta(exceptRow = null) {
    document.querySelectorAll(".message-row.meta-visible").forEach((row) => {
        if (row !== exceptRow) {
            row.classList.remove("meta-visible");
        }
    });
}

function openMessageMenu(menuElement) {
    if (activeMessageMenu && activeMessageMenu !== menuElement) {
        activeMessageMenu.classList.remove("open");
    }

    menuElement.classList.add("open");
    activeMessageMenu = menuElement;
}

function toggleMessageMenu(menuElement) {
    if (menuElement.classList.contains("open")) {
        closeActiveMessageMenu();
        return;
    }

    openMessageMenu(menuElement);
}

function toggleMobileMessageActions(rowElement) {
    if (!isCoarsePointerDevice()) {
        return;
    }

    if (rowElement.classList.contains("actions-visible")) {
        rowElement.classList.remove("actions-visible");
        closeActiveMessageMenu();
        return;
    }

    clearVisibleMessageActions(rowElement);
    rowElement.classList.add("actions-visible");
}

function toggleMobileMessageMeta(rowElement) {
    if (!isCoarsePointerDevice()) {
        return;
    }

    if (rowElement.classList.contains("meta-visible")) {
        rowElement.classList.remove("meta-visible");
        return;
    }

    clearVisibleMessageMeta(rowElement);
    rowElement.classList.add("meta-visible");
}

function ensureEditedTag(metaElement, rowElement) {
    if (!metaElement || metaElement.querySelector(".edited-tag")) {
        return;
    }

    const editedTag = document.createElement("span");
    editedTag.className = "edited-tag";
    editedTag.textContent = "已编辑";

    const usernameElement = metaElement.querySelector(".username");
    const isOwnRow = Boolean(rowElement?.classList.contains("own-row"));

    if (isOwnRow && usernameElement) {
        metaElement.insertBefore(editedTag, usernameElement);
        return;
    }

    metaElement.appendChild(editedTag);
}

function requestEditMessage(messageId, rowElement) {
    const currentContent =
        rowElement.querySelector(".content")?.textContent || "";
    const nextMessage = prompt("编辑消息", currentContent);
    if (nextMessage === null) {
        return;
    }

    const trimmed = safeText(nextMessage).trim();
    if (!trimmed) {
        showError("消息不能为空");
        return;
    }

    socket.emit("edit_message", {
        id: messageId,
        message: trimmed,
    });
}

function requestDeleteMessage(messageId) {
    if (!confirm("确定删除这条消息吗？")) {
        return;
    }

    socket.emit("delete_message", {
        id: messageId,
    });
}

// 发送消息
function sendMessage() {
    const message = safeText(messageInput.value).trim();
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
    if (typeof data.id === "number") {
        const existing = document.querySelector(
            `.message-row[data-id="${data.id}"]`,
        );
        if (existing) {
            return;
        }
    }

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

    const messageElement = createMessageElement({
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
});

function createMessageElement({
    isOwn,
    avatarUrl,
    transformed_timestamp,
    data,
}) {
    const rowElement = document.createElement("div");
    rowElement.className = `message-row ${isOwn ? "own-row" : "other-row"}`;
    if (typeof data.id === "number") {
        rowElement.dataset.id = String(data.id);
    }

    const mainElement = document.createElement("div");
    mainElement.className = "message-main";

    const metaElement = document.createElement("div");
    metaElement.className = "message-meta";

    const timeElement = document.createElement("span");
    timeElement.className = "timestamp";
    timeElement.textContent = transformed_timestamp;

    const nameElement = document.createElement("span");
    nameElement.className = `username ${data.is_admin ? "admin-username" : ""}`;
    nameElement.textContent = safeText(data.username);

    if (isOwn) {
        metaElement.append(timeElement, nameElement);
    } else {
        metaElement.append(nameElement, timeElement);
    }

    if (data.edited_at) {
        ensureEditedTag(metaElement, rowElement);
    }

    const bubbleElement = document.createElement("div");
    bubbleElement.className = "message-bubble";

    if (isCoarsePointerDevice()) {
        bubbleElement.addEventListener("click", (event) => {
            if (event.target.closest(".message-actions-menu")) {
                return;
            }
            event.stopPropagation();
            toggleMobileMessageMeta(rowElement);
        });
    }

    const contentElement = document.createElement("p");
    contentElement.className = "content";
    contentElement.textContent = safeText(data.message);
    bubbleElement.appendChild(contentElement);

    if (isMessageManageable(data) && typeof data.id === "number") {
        const menuWrapper = document.createElement("div");
        menuWrapper.className = "message-actions-menu";

        const triggerButton = document.createElement("button");
        triggerButton.type = "button";
        triggerButton.className = "message-menu-trigger";
        triggerButton.setAttribute("aria-label", "消息操作");
        triggerButton.textContent = "⋮";

        const menuElement = document.createElement("div");
        menuElement.className = "message-menu-dropdown";

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "message-menu-item";
        editButton.textContent = "编辑";
        editButton.addEventListener("click", (event) => {
            event.stopPropagation();
            closeActiveMessageMenu();
            requestEditMessage(data.id, rowElement);
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "message-menu-item danger";
        deleteButton.textContent = "删除";
        deleteButton.addEventListener("click", (event) => {
            event.stopPropagation();
            closeActiveMessageMenu();
            requestDeleteMessage(data.id);
        });

        triggerButton.addEventListener("click", (event) => {
            event.stopPropagation();
            clearVisibleMessageActions(rowElement);
            clearVisibleMessageMeta(rowElement);
            rowElement.classList.add("actions-visible");
            rowElement.classList.add("meta-visible");
            toggleMessageMenu(menuElement);
        });

        bubbleElement.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            openMessageMenu(menuElement);
        });

        menuElement.addEventListener("click", (event) => {
            event.stopPropagation();
        });

        if (isCoarsePointerDevice()) {
            bubbleElement.addEventListener("click", (event) => {
                if (event.target.closest(".message-actions-menu")) {
                    return;
                }
                event.stopPropagation();
                toggleMobileMessageActions(rowElement);
            });
        }

        menuElement.append(editButton, deleteButton);
        menuWrapper.append(triggerButton, menuElement);
        bubbleElement.appendChild(menuWrapper);
    }

    mainElement.append(metaElement, bubbleElement);

    if (!isOwn) {
        rowElement.appendChild(createAvatarElement(avatarUrl, data.username));
    }

    rowElement.appendChild(mainElement);

    if (isOwn) {
        rowElement.appendChild(createAvatarElement(avatarUrl, data.username));
    }

    return rowElement;
}

socket.on("message_updated", function (data) {
    if (typeof data.id !== "number") {
        return;
    }

    const rowElement = document.querySelector(
        `.message-row[data-id="${data.id}"]`,
    );
    if (!rowElement) {
        return;
    }

    const contentElement = rowElement.querySelector(".content");
    if (contentElement) {
        contentElement.textContent = safeText(data.message);
    }

    const metaElement = rowElement.querySelector(".message-meta");
    if (metaElement) {
        ensureEditedTag(metaElement, rowElement);
    }
});

socket.on("message_deleted", function (data) {
    if (typeof data.id !== "number") {
        return;
    }

    const rowElement = document.querySelector(
        `.message-row[data-id="${data.id}"]`,
    );
    if (rowElement) {
        rowElement.remove();
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

document.addEventListener("click", () => {
    closeActiveMessageMenu();
    clearVisibleMessageActions();
    clearVisibleMessageMeta();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeActiveMessageMenu();
    }
});

/* --- MISCS FOR MESSAGE DISPLAY --- */

function safeText(value) {
    if (typeof value === "string") {
        return value;
    }
    if (value === null || value === undefined) {
        return "";
    }
    return String(value);
}

function createAvatarElement(avatarUrl, userName) {
    const avatarElement = document.createElement("img");
    avatarElement.className = "message-avatar";
    avatarElement.src = avatarUrl;
    avatarElement.alt = `${safeText(userName)}头像`;
    return avatarElement;
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
