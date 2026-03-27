const socket = io();

let lastMessageId = 0;
let lastDividerTimeMs = null;
let activeMessageMenu = null;
let activeMessageMenuRow = null;
let isSocketConnected = false;
const TIME_DIVIDER_THRESHOLD_MS = 5 * 60 * 1000;

const messagesContainer = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const chatLayoutElement = document.querySelector(".chat-layout");
const conversationListElement = document.getElementById("conversation-list");
const conversationTitleElement = document.getElementById("conversation-title");
const sidebarToggleButton = document.getElementById("sidebar-toggle-button");
const newPrivateChatButton = document.getElementById("new-private-chat");
const attachButton = document.getElementById("attach-button");
const attachMenu = document.getElementById("attach-menu");
const uploadImageAction = document.getElementById("upload-image-action");
const uploadFileAction = document.getElementById("upload-file-action");
const imageFileInput = document.getElementById("image-file-input");
const genericFileInput = document.getElementById("generic-file-input");
const privateChatModal = document.getElementById("private-chat-modal");
const privateChatUserSelect = document.getElementById(
    "private-chat-user-select",
);
const privateChatCancelButton = document.getElementById("private-chat-cancel");
const privateChatConfirmButton = document.getElementById(
    "private-chat-confirm",
);

const conversations = new Map();
let activeConversationKey = "public";
const onlineUsers = new Set();
let desktopSidebarCollapsed = false;
let mobileSidebarVisible = false;
let isMobileMode = false;
let scheduledScrollRafId = null;
let scheduledScrollTimeoutId = null;
let stickyScrollIntervalId = null;
let isHydratingConversation = false;
const MESSAGE_SYNC_FALLBACK_LIMIT = 50;

function detectMobileMode() {
    return window.matchMedia("(max-width: 900px)").matches;
}

function applySidebarLayoutState() {
    if (!chatLayoutElement) {
        return;
    }

    chatLayoutElement.classList.toggle("mobile-mode", isMobileMode);

    const shouldCollapse = isMobileMode
        ? !mobileSidebarVisible
        : desktopSidebarCollapsed;
    chatLayoutElement.classList.toggle("sidebar-collapsed", shouldCollapse);
    chatLayoutElement.classList.toggle(
        "mobile-sidebar-visible",
        isMobileMode && mobileSidebarVisible,
    );

    if (sidebarToggleButton) {
        if (shouldCollapse) {
            sidebarToggleButton.dataset.state = "collapsed";
            sidebarToggleButton.setAttribute("aria-label", "展开侧栏");
            sidebarToggleButton.setAttribute("title", "展开侧栏");
        } else {
            sidebarToggleButton.dataset.state = "expanded";
            sidebarToggleButton.setAttribute("aria-label", "折叠侧栏");
            sidebarToggleButton.setAttribute("title", "折叠侧栏");
        }
    }
}

function toggleSidebar() {
    if (isMobileMode) {
        mobileSidebarVisible = !mobileSidebarVisible;
    } else {
        desktopSidebarCollapsed = !desktopSidebarCollapsed;
    }
    applySidebarLayoutState();
}

function refreshViewportSidebarMode() {
    const nextMobileMode = detectMobileMode();
    if (nextMobileMode !== isMobileMode) {
        isMobileMode = nextMobileMode;
        if (isMobileMode) {
            mobileSidebarVisible = true;
        }
    }
    applySidebarLayoutState();
}

function conversationKey(conversationType, peerUsername = "") {
    if (conversationType === "private" && peerUsername) {
        return `private:${peerUsername}`;
    }
    return "public";
}

function conversationLabel(conversationType, peerUsername = "") {
    if (conversationType === "private" && peerUsername) {
        return peerUsername;
    }
    return "聊天室";
}

function createConversation(conversationType, peerUsername = "") {
    const key = conversationKey(conversationType, peerUsername);
    return {
        key,
        conversationType,
        peerUsername,
        label: conversationLabel(conversationType, peerUsername),
        hasUnread: false,
    };
}

function ensureConversation(conversationType, peerUsername = "") {
    const key = conversationKey(conversationType, peerUsername);
    if (!conversations.has(key)) {
        conversations.set(
            key,
            createConversation(conversationType, peerUsername),
        );
    }
    return conversations.get(key);
}

function buildConversationList() {
    conversations.clear();
    ensureConversation("public", "");

    renderConversationList();
}

async function hydratePrivateConversations() {
    try {
        const response = await fetch("/chat/private-conversations", {
            method: "GET",
            credentials: "same-origin",
        });
        if (!response.ok) {
            return;
        }

        const payload = await response.json();
        const peers = Array.isArray(payload?.peers) ? payload.peers : [];
        peers
            .map((name) => safeText(name).trim())
            .filter((name) => name && name !== username)
            .forEach((name) => {
                ensureConversation("private", name);
            });

        renderConversationList();
    } catch (error) {}
}

function renderConversationList() {
    if (!conversationListElement) {
        return;
    }

    conversationListElement.innerHTML = "";

    const ordered = Array.from(conversations.values()).sort((a, b) => {
        if (a.key === "public") {
            return -1;
        }
        if (b.key === "public") {
            return 1;
        }
        return a.label.localeCompare(b.label, "zh-CN");
    });

    ordered.forEach((conversation) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "conversation-item";
        if (conversation.key === activeConversationKey) {
            item.classList.add("active");
        }

        const suffix = conversation.hasUnread ? " •" : "";
        item.textContent = `${conversation.label}${suffix}`;
        item.addEventListener("click", () => {
            switchConversation(conversation.key);
            if (isMobileMode) {
                mobileSidebarVisible = false;
                applySidebarLayoutState();
            }
        });

        conversationListElement.appendChild(item);
    });
}

function updateConversationTitle() {
    const activeConversation = conversations.get(activeConversationKey);
    if (!activeConversation || !conversationTitleElement) {
        return;
    }

    if (activeConversation.conversationType === "public") {
        conversationTitleElement.textContent = `聊天室 · ${onlineUsers.size} 人在线`;
        return;
    }

    const peer = activeConversation.peerUsername;
    const isPeerOnline = Boolean(peer && onlineUsers.has(peer));
    conversationTitleElement.textContent = `${activeConversation.label} · ${isPeerOnline ? "在线" : "离线"}`;
}

function clearMessagesView() {
    messagesContainer.innerHTML = "";
    lastMessageId = 0;
    lastDividerTimeMs = null;
    closeActiveMessageMenu();
}

function stopStickyBottomMode() {
    if (stickyScrollIntervalId !== null) {
        clearInterval(stickyScrollIntervalId);
        stickyScrollIntervalId = null;
    }
}

function startStickyBottomMode(durationMs = 0) {
    stopStickyBottomMode();
    if (durationMs <= 0) {
        return;
    }

    const startedAt = Date.now();
    stickyScrollIntervalId = setInterval(() => {
        if (Date.now() - startedAt >= durationMs) {
            stopStickyBottomMode();
            return;
        }
        scrollToBottom();
    }, 120);
}

function switchConversation(nextKey, options = {}) {
    const keepSidebarOnMobile = Boolean(options.keepSidebarOnMobile);
    if (!conversations.has(nextKey)) {
        return;
    }

    activeConversationKey = nextKey;
    isHydratingConversation = true;
    const activeConversation = conversations.get(activeConversationKey);
    activeConversation.hasUnread = false;

    clearMessagesView();
    renderConversationList();
    updateConversationTitle();
    requestMessages();

    if (isMobileMode && !keepSidebarOnMobile) {
        mobileSidebarVisible = false;
        applySidebarLayoutState();
    }
}

function normalizeIncomingConversation(data) {
    if (data.conversation_type === "private") {
        const peer = safeText(data.conversation_peer || "").trim();
        if (!peer) {
            return null;
        }
        ensureConversation("private", peer);
        return {
            conversationType: "private",
            peerUsername: peer,
            key: conversationKey("private", peer),
        };
    }

    ensureConversation("public", "");
    return {
        conversationType: "public",
        peerUsername: "",
        key: "public",
    };
}

function getActiveConversation() {
    return (
        conversations.get(activeConversationKey) ||
        createConversation("public", "")
    );
}

function isMessageManageable(data) {
    const activeConversation = getActiveConversation();
    const isOwn = data.username === username;
    const messageType = safeText(data.message_type || "text").toLowerCase();
    if (activeConversation.conversationType === "private") {
        return isOwn;
    }

    const fromAdmin = Boolean(data.is_admin);
    if (messageType !== "text") {
        return isOwn || (userIsAdmin && !fromAdmin);
    }
    return isOwn || (userIsAdmin && !fromAdmin);
}

function updateOnlineStatus(status) {
    const indicator = document.querySelector(".online-indicator");
    if (indicator) {
        if (status === "connected") {
            indicator.classList.remove("offline");
        } else {
            indicator.classList.add("offline");
        }
    }

    isSocketConnected = status === "connected";
    sendButton.disabled = !isSocketConnected;
}

socket.on("force_disconnect", function () {
    socket.disconnect();
    updateOnlineStatus("disconnected");

    setTimeout(() => {
        window.location.href = "/login";
    }, 1000);
});

socket.on("connect", () => {
    updateOnlineStatus("connected");
    requestMessages();
});

socket.on("disconnect", () => {
    updateOnlineStatus("disconnected");
    onlineUsers.clear();
    updateConversationTitle();
});

socket.on("online_presence", (payload) => {
    const names = Array.isArray(payload?.usernames) ? payload.usernames : [];
    onlineUsers.clear();
    names.forEach((name) => {
        const normalized = safeText(name).trim();
        if (normalized) {
            onlineUsers.add(normalized);
        }
    });
    updateConversationTitle();
});

function isCoarsePointerDevice() {
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

function closeActiveMessageMenu() {
    if (activeMessageMenu) {
        activeMessageMenu.classList.remove("open");
        activeMessageMenu = null;
    }
    if (activeMessageMenuRow) {
        activeMessageMenuRow.classList.remove("menu-open");
        activeMessageMenuRow = null;
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
        if (activeMessageMenuRow) {
            activeMessageMenuRow.classList.remove("menu-open");
        }
    }

    const rowElement = menuElement.closest(".message-row");
    if (rowElement) {
        rowElement.classList.add("menu-open");
        activeMessageMenuRow = rowElement;
    }

    menuElement.classList.add("open");
    adjustMessageMenuDirection(menuElement);
    activeMessageMenu = menuElement;
}

function adjustMessageMenuDirection(menuElement) {
    if (!menuElement) {
        return;
    }

    menuElement.classList.remove("open-up");
    const margin = 8;
    const containerRect = messagesContainer
        ? messagesContainer.getBoundingClientRect()
        : null;
    const boundaryTop = containerRect ? containerRect.top : 0;
    const boundaryBottom = containerRect
        ? containerRect.bottom
        : window.innerHeight;

    const downRect = menuElement.getBoundingClientRect();
    const lacksDownSpace = downRect.bottom > boundaryBottom - margin;

    if (lacksDownSpace) {
        menuElement.classList.add("open-up");
        const upRect = menuElement.getBoundingClientRect();
        if (upRect.top < boundaryTop + margin) {
            menuElement.classList.remove("open-up");
        }
    }
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

function sendMessage() {
    const message = safeText(messageInput.value).trim();
    if (!message) {
        return;
    }

    const activeConversation = getActiveConversation();
    socket.emit("send_message", {
        message,
        conversationType: activeConversation.conversationType,
        peerUsername: activeConversation.peerUsername,
    });
    messageInput.value = "";
}

function closeAttachMenu() {
    if (!attachMenu) {
        return;
    }
    attachMenu.hidden = true;
}

function toggleAttachMenu() {
    if (!attachMenu) {
        return;
    }
    attachMenu.hidden = !attachMenu.hidden;
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "未知大小";
    }
    if (bytes < 1024) {
        return `${bytes}B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)}KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function uploadAttachment(file, uploadKind) {
    if (!file) {
        return;
    }

    const activeConversation = getActiveConversation();
    const text = safeText(messageInput.value).trim();
    if (text) {
        showError("文本与附件不能同时发送，请先清空输入框");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("uploadKind", uploadKind);
    formData.append("conversationType", activeConversation.conversationType);
    formData.append("peerUsername", activeConversation.peerUsername || "");

    closeAttachMenu();
    sendButton.disabled = true;

    fetch("/chat/upload", {
        method: "POST",
        body: formData,
    })
        .then((response) =>
            response.json().then((payload) => ({ ok: response.ok, payload })),
        )
        .then(({ ok, payload }) => {
            if (!ok) {
                showError(payload?.error || "上传失败");
                return;
            }

            socket.emit("send_message", {
                messageType: payload.messageType,
                fileUrl: payload.fileUrl,
                fileName: payload.fileName,
                fileSize: payload.fileSize,
                fileMime: payload.fileMime,
                conversationType: activeConversation.conversationType,
                peerUsername: activeConversation.peerUsername,
                message: "",
            });
        })
        .catch(() => {
            showError("上传失败，请稍后重试");
        })
        .finally(() => {
            sendButton.disabled = !isSocketConnected;
            if (imageFileInput) {
                imageFileInput.value = "";
            }
            if (genericFileInput) {
                genericFileInput.value = "";
            }
        });
}

function requestMessages() {
    if (!isSocketConnected) {
        return;
    }

    const activeConversation = getActiveConversation();
    socket.emit("check_messages", {
        lastId: lastMessageId,
        conversationType: activeConversation.conversationType,
        peerUsername: activeConversation.peerUsername,
    });
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function scheduleScrollToBottom(options = {}) {
    const keepPinnedMs = Number(options.keepPinnedMs || 0);

    if (scheduledScrollRafId !== null) {
        cancelAnimationFrame(scheduledScrollRafId);
    }
    if (scheduledScrollTimeoutId !== null) {
        clearTimeout(scheduledScrollTimeoutId);
        scheduledScrollTimeoutId = null;
    }

    scheduledScrollRafId = requestAnimationFrame(() => {
        scheduledScrollRafId = null;
        scrollToBottom();
        scheduledScrollTimeoutId = setTimeout(() => {
            scheduledScrollTimeoutId = null;
            scrollToBottom();
        }, 70);
    });

    if (keepPinnedMs > 0) {
        startStickyBottomMode(keepPinnedMs);
    }
}

socket.on("message", function (data) {
    const incomingConversation = normalizeIncomingConversation(data);
    if (!incomingConversation) {
        return;
    }

    const isActiveConversation =
        incomingConversation.key === activeConversationKey;
    if (!isActiveConversation) {
        const conversation = conversations.get(incomingConversation.key);
        if (conversation) {
            conversation.hasUnread = true;
        }
        renderConversationList();
        return;
    }

    if (typeof data.id === "number") {
        const existing = document.querySelector(
            `.message-row[data-id=\"${data.id}\"]`,
        );
        if (existing) {
            return;
        }
    }

    if (typeof data.id === "number" && data.id <= lastMessageId) {
        return;
    }

    const utcTimestamp = new Date(data.timestamp);
    const date = new Date(
        utcTimestamp.getTime() - utcTimestamp.getTimezoneOffset() * 60 * 1000,
    );
    const transformedTimestamp = date
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
    );

    const messageElement = createMessageElement({
        isOwn,
        avatarUrl,
        transformedTimestamp,
        data,
    });

    messagesContainer.appendChild(messageElement);

    if (typeof data.id === "number") {
        lastMessageId = data.id;
    }

    if (!isHydratingConversation) {
        scheduleScrollToBottom();
    }
});

socket.on("messages_sync_complete", (payload) => {
    const incomingConversation = normalizeIncomingConversation(payload || {});
    if (!incomingConversation) {
        return;
    }

    if (incomingConversation.key !== activeConversationKey) {
        return;
    }

    const count = Number(payload?.count || 0);
    const limit = Number(payload?.limit || MESSAGE_SYNC_FALLBACK_LIMIT);

    if (count >= limit && limit > 0) {
        requestMessages();
        return;
    }

    if (isHydratingConversation) {
        isHydratingConversation = false;
        scheduleScrollToBottom({ keepPinnedMs: 320 });
    }
});

function createMessageElement({
    isOwn,
    avatarUrl,
    transformedTimestamp,
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
    timeElement.textContent = transformedTimestamp;

    const activeConversation = getActiveConversation();
    const showAdmin =
        activeConversation.conversationType !== "private" && data.is_admin;

    const nameElement = document.createElement("span");
    nameElement.className = `username ${showAdmin ? "admin-username" : ""}`;
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
    const messageType = safeText(data.message_type || "text").toLowerCase();

    if (messageType === "image" && data.file_url) {
        bubbleElement.classList.add("image-only-bubble");
        const imageLink = document.createElement("a");
        imageLink.href = data.file_url;
        imageLink.target = "_blank";
        imageLink.rel = "noopener noreferrer";

        const imageElement = document.createElement("img");
        imageElement.className = "message-image";
        imageElement.src = data.file_url;
        imageElement.alt = safeText(data.file_name || "图片消息");
        imageElement.loading = "lazy";
        imageElement.addEventListener("load", () => {
            scheduleScrollToBottom();
        });

        imageLink.appendChild(imageElement);
        bubbleElement.appendChild(imageLink);
    } else if (messageType === "file" && data.file_url) {
        const fileLink = document.createElement("a");
        fileLink.className = "message-file-link";
        fileLink.href = data.file_url;
        fileLink.target = "_blank";
        fileLink.rel = "noopener noreferrer";
        fileLink.textContent = `📎 ${safeText(data.file_name || "文件")}`;

        const fileMeta = document.createElement("div");
        fileMeta.className = "message-file-meta";
        fileMeta.textContent = formatFileSize(Number(data.file_size || 0));

        bubbleElement.append(fileLink, fileMeta);
    } else {
        contentElement.className = "content";
        contentElement.textContent = safeText(data.message);
        bubbleElement.appendChild(contentElement);
    }

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
        const messageTypeForActions = safeText(
            data.message_type || "text",
        ).toLowerCase();

        if (messageTypeForActions === "text") {
            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "message-menu-item";
            editButton.textContent = "编辑";
            editButton.addEventListener("click", (event) => {
                event.stopPropagation();
                closeActiveMessageMenu();
                requestEditMessage(data.id, rowElement);
            });
            menuElement.appendChild(editButton);
        }

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

        menuElement.appendChild(deleteButton);
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
        `.message-row[data-id=\"${data.id}\"]`,
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
        `.message-row[data-id=\"${data.id}\"]`,
    );
    if (rowElement) {
        rowElement.remove();
    }
});

sendButton.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", function (event) {
    if (event.key === "Enter" && !sendButton.disabled) {
        sendMessage();
    }
});

if (attachButton) {
    attachButton.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleAttachMenu();
    });
}

if (uploadImageAction && imageFileInput) {
    uploadImageAction.addEventListener("click", () => {
        closeAttachMenu();
        imageFileInput.click();
    });
    imageFileInput.addEventListener("change", () => {
        const [file] = imageFileInput.files || [];
        uploadAttachment(file, "image");
    });
}

if (uploadFileAction && genericFileInput) {
    uploadFileAction.addEventListener("click", () => {
        closeAttachMenu();
        genericFileInput.click();
    });
    genericFileInput.addEventListener("change", () => {
        const [file] = genericFileInput.files || [];
        uploadAttachment(file, "file");
    });
}

if (newPrivateChatButton) {
    newPrivateChatButton.addEventListener("click", openPrivateChatModal);
}

if (sidebarToggleButton) {
    sidebarToggleButton.addEventListener("click", toggleSidebar);
}

function listPrivateCandidates() {
    const base = Array.isArray(availableUsers) ? availableUsers : [];
    return base
        .map((name) => safeText(name).trim())
        .filter((name) => name && name !== username);
}

function openPrivateChatModal() {
    if (!privateChatModal || !privateChatUserSelect) {
        return;
    }

    const users = listPrivateCandidates();
    if (!users.length) {
        showError("暂无可私聊用户");
        return;
    }

    privateChatUserSelect.innerHTML = "";
    users.forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        privateChatUserSelect.appendChild(option);
    });

    privateChatModal.hidden = false;
    privateChatModal.setAttribute("aria-hidden", "false");
    privateChatUserSelect.focus();
}

function closePrivateChatModal() {
    if (!privateChatModal) {
        return;
    }

    privateChatModal.hidden = true;
    privateChatModal.setAttribute("aria-hidden", "true");
}

function confirmPrivateChatSelection() {
    if (!privateChatUserSelect) {
        return;
    }

    const target = safeText(privateChatUserSelect.value).trim();
    const users = listPrivateCandidates();
    if (!target || !users.includes(target)) {
        showError("用户不存在");
        return;
    }

    ensureConversation("private", target);
    renderConversationList();
    switchConversation(conversationKey("private", target));
    closePrivateChatModal();
}

if (privateChatCancelButton) {
    privateChatCancelButton.addEventListener("click", closePrivateChatModal);
}

if (privateChatConfirmButton) {
    privateChatConfirmButton.addEventListener(
        "click",
        confirmPrivateChatSelection,
    );
}

if (privateChatUserSelect) {
    privateChatUserSelect.addEventListener(
        "dblclick",
        confirmPrivateChatSelection,
    );
    privateChatUserSelect.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            confirmPrivateChatSelection();
        }
    });
}

if (privateChatModal) {
    privateChatModal.addEventListener("click", (event) => {
        if (event.target === privateChatModal) {
            closePrivateChatModal();
        }
    });
}

setInterval(() => {
    requestMessages();
}, 5000);

window.onload = async function () {
    isMobileMode = detectMobileMode();
    mobileSidebarVisible = isMobileMode;
    applySidebarLayoutState();

    buildConversationList();
    await hydratePrivateConversations();
    closePrivateChatModal();
    switchConversation("public", { keepSidebarOnMobile: true });
    updateOnlineStatus(socket.connected ? "connected" : "disconnected");
};

document.addEventListener("click", () => {
    closeAttachMenu();
    closeActiveMessageMenu();
    clearVisibleMessageActions();
    clearVisibleMessageMeta();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        if (privateChatModal && !privateChatModal.hidden) {
            closePrivateChatModal();
            return;
        }
        closeActiveMessageMenu();
    }
});

window.addEventListener("resize", () => {
    refreshViewportSidebarMode();
    if (activeMessageMenu && activeMessageMenu.classList.contains("open")) {
        adjustMessageMenuDirection(activeMessageMenu);
    }
});

if (messagesContainer) {
    messagesContainer.addEventListener("scroll", () => {});
}

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

function resolveAvatarUrl(avatarUrl) {
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
