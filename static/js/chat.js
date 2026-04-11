const socket = io();

let lastMessageId = 0;
let lastDividerTimeMs = null;
let activeMessageMenu = null;
let activeMessageMenuRow = null;
let isSocketConnected = false;
const TIME_DIVIDER_THRESHOLD_MS = 5 * 60 * 1000;
const MESSAGE_SYNC_TIMEOUT_MS = 8000;
const MESSAGE_SYNC_MAX_RETRIES = 4;

const messagesContainer = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const newMessagesIndicator = document.getElementById("new-messages-indicator");
const newMessagesIndicatorText = document.getElementById(
    "new-messages-indicator-text",
);
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
const imagePreviewModal = document.getElementById("image-preview-modal");
const imagePreviewTarget = document.getElementById("image-preview-target");
const imagePreviewName = document.getElementById("image-preview-name");
const imagePreviewCloseButton = document.querySelector(".image-preview-close");
const replyPreview = document.getElementById("reply-preview");
const replyPreviewUser = document.getElementById("reply-preview-user");
const replyPreviewSnippet = document.getElementById("reply-preview-snippet");
const replyPreviewCancelButton = document.getElementById(
    "reply-preview-cancel",
);
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
let isHydratingConversation = false;
const MESSAGE_SYNC_FALLBACK_LIMIT = 50;
let syncRequestSequence = 0;
let currentSyncRequest = null;
let queuedMessageSync = false;
let pendingRealtimeMessages = [];
let syncTimeoutId = null;
let activeReplyTarget = null;
const messagePayloadById = new Map();
let startupAutoScrollEnabled = true;
let hasCompletedStartupHydration = false;
let activeConversationPendingMessages = 0;
let pendingMarkReadRequest = false;
let markReadRequestInFlight = false;

function detectMobileMode() {
    return window.matchMedia("(max-width: 900px)").matches;
}

function setAppHeight() {
    const viewportHeight = window.visualViewport
        ? Math.round(window.visualViewport.height)
        : window.innerHeight;
    document.documentElement.style.setProperty(
        "--app-height",
        `${viewportHeight}px`,
    );
}

document.addEventListener("DOMContentLoaded", () => {
    setAppHeight();
});

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
        unreadCount: 0,
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

function setConversationUnreadCount(conversationKeyValue, unreadCount) {
    const conversation = conversations.get(conversationKeyValue);
    if (!conversation) {
        return;
    }
    const normalizedCount = Number.isFinite(Number(unreadCount))
        ? Math.max(0, Math.floor(Number(unreadCount)))
        : 0;
    conversation.unreadCount = normalizedCount;
}

function increaseConversationUnreadCount(conversationKeyValue, delta = 1) {
    const conversation = conversations.get(conversationKeyValue);
    if (!conversation) {
        return;
    }
    const normalizedDelta = Number.isFinite(Number(delta))
        ? Math.max(0, Math.floor(Number(delta)))
        : 0;
    conversation.unreadCount = Math.max(
        0,
        Number(conversation.unreadCount || 0) + normalizedDelta,
    );
}

function formatUnreadCount(unreadCount) {
    if (unreadCount > 99) {
        return "99+";
    }
    return `${unreadCount}`;
}

function applyUnreadCounts(counts) {
    const unreadMap = counts && typeof counts === "object" ? counts : {};
    conversations.forEach((conversation) => {
        const nextCount = Number(unreadMap[conversation.key] || 0);
        setConversationUnreadCount(conversation.key, nextCount);
    });

    setConversationUnreadCount(activeConversationKey, 0);
    renderConversationList();
}

async function hydrateUnreadCounts() {
    try {
        const response = await fetch("/chat/unread-counts", {
            method: "GET",
            credentials: "same-origin",
        });
        if (!response.ok) {
            return;
        }

        const payload = await response.json();
        applyUnreadCounts(payload?.counts || {});
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

        const contentElement = document.createElement("span");
        contentElement.className = "conversation-item-content";

        if (conversation.conversationType === "private") {
            const statusDot = document.createElement("span");
            const isPeerOnline = onlineUsers.has(conversation.peerUsername);
            statusDot.className = `conversation-status-dot ${isPeerOnline ? "online" : "offline"}`;
            statusDot.setAttribute("aria-hidden", "true");
            item.title = `${conversation.label}（${isPeerOnline ? "在线" : "离线"}）`;
            contentElement.appendChild(statusDot);
        }

        const labelElement = document.createElement("span");
        labelElement.className = "conversation-item-label";
        labelElement.textContent = conversation.label;
        contentElement.appendChild(labelElement);
        item.appendChild(contentElement);

        const metaElement = document.createElement("span");
        metaElement.className = "conversation-item-meta";
        let hasMeta = false;

        if (
            conversation.key !== activeConversationKey &&
            Number(conversation.unreadCount || 0) > 0
        ) {
            const unreadBadge = document.createElement("span");
            unreadBadge.className = "conversation-unread-badge";
            unreadBadge.textContent = formatUnreadCount(
                Number(conversation.unreadCount || 0),
            );
            metaElement.appendChild(unreadBadge);
            hasMeta = true;
        }

        if (hasMeta) {
            item.appendChild(metaElement);
        }

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
    messagePayloadById.clear();
    currentSyncRequest = null;
    queuedMessageSync = false;
    pendingRealtimeMessages = [];
    if (syncTimeoutId !== null) {
        clearTimeout(syncTimeoutId);
        syncTimeoutId = null;
    }
    clearReplyTarget();
    closeActiveMessageMenu();
}

function isMessagesViewNearBottom(thresholdPx = 32) {
    if (!messagesContainer) {
        return true;
    }

    const distanceToBottom =
        messagesContainer.scrollHeight -
        messagesContainer.scrollTop -
        messagesContainer.clientHeight;
    return distanceToBottom <= thresholdPx;
}

function updateNewMessagesIndicator() {
    if (!newMessagesIndicator || !newMessagesIndicatorText) {
        return;
    }

    const unreadCount = Math.max(0, Number(activeConversationPendingMessages));
    const hasUnread = unreadCount > 0;
    const hasScrollableMessages = messagesContainer
        ? messagesContainer.scrollHeight - messagesContainer.clientHeight > 8
        : false;
    const shouldShow =
        hasUnread || (hasScrollableMessages && !isMessagesViewNearBottom());

    if (!shouldShow) {
        newMessagesIndicator.classList.remove("has-unread");
        delete newMessagesIndicator.dataset.unreadCount;
        newMessagesIndicator.hidden = true;
        return;
    }

    newMessagesIndicatorText.textContent = "↓";
    if (hasUnread) {
        const unreadLabel = `${unreadCount}条新消息`;
        newMessagesIndicator.classList.add("has-unread");
        newMessagesIndicator.dataset.unreadCount =
            formatUnreadCount(unreadCount);
        newMessagesIndicator.setAttribute(
            "aria-label",
            `${unreadLabel}，点击滚动到底部`,
        );
        newMessagesIndicator.setAttribute("title", unreadLabel);
    } else {
        newMessagesIndicator.classList.remove("has-unread");
        delete newMessagesIndicator.dataset.unreadCount;
        newMessagesIndicator.setAttribute("aria-label", "滚动到底部");
        newMessagesIndicator.setAttribute("title", "滚动到底部");
    }

    newMessagesIndicator.hidden = false;
}

function queueMarkActiveConversationRead() {
    pendingMarkReadRequest = true;
    markActiveConversationRead();
}

async function markActiveConversationRead(lastMessageId = null) {
    if (!pendingMarkReadRequest && !Number.isFinite(Number(lastMessageId))) {
        return;
    }

    if (markReadRequestInFlight) {
        return;
    }

    const activeConversation = getActiveConversation();
    const payload = {
        conversationType: activeConversation.conversationType,
        peerUsername: activeConversation.peerUsername || "",
    };

    const normalizedLastId = Number(lastMessageId);
    if (Number.isFinite(normalizedLastId) && normalizedLastId > 0) {
        payload.lastMessageId = Math.floor(normalizedLastId);
    }

    pendingMarkReadRequest = false;
    markReadRequestInFlight = true;
    try {
        await fetch("/chat/mark-read", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "same-origin",
            body: JSON.stringify(payload),
        });
    } catch (error) {
    } finally {
        markReadRequestInFlight = false;
        if (pendingMarkReadRequest) {
            markActiveConversationRead();
        }
    }
}

function clearActiveConversationPendingMessages({ markRead = false } = {}) {
    activeConversationPendingMessages = 0;
    updateNewMessagesIndicator();
    if (markRead) {
        queueMarkActiveConversationRead();
    }
}

function increaseActiveConversationPendingMessages(delta = 1) {
    const normalizedDelta = Number.isFinite(Number(delta))
        ? Math.max(0, Math.floor(Number(delta)))
        : 0;
    if (normalizedDelta <= 0) {
        return;
    }

    activeConversationPendingMessages += normalizedDelta;
    updateNewMessagesIndicator();
}

function switchConversation(nextKey, options = {}) {
    const keepSidebarOnMobile = Boolean(options.keepSidebarOnMobile);
    if (!conversations.has(nextKey)) {
        return;
    }

    activeConversationKey = nextKey;
    isHydratingConversation = true;
    const activeConversation = conversations.get(activeConversationKey);
    setConversationUnreadCount(activeConversationKey, 0);
    clearActiveConversationPendingMessages({ markRead: false });

    clearMessagesView();
    renderConversationList();
    updateConversationTitle();
    requestMessages();
    queueMarkActiveConversationRead();

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

function canDeleteMessage(data) {
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

function canEditMessage(data) {
    return data.username === username;
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
    currentSyncRequest = null;
    queuedMessageSync = false;
    pendingRealtimeMessages = [];
    if (syncTimeoutId !== null) {
        clearTimeout(syncTimeoutId);
        syncTimeoutId = null;
    }
    onlineUsers.clear();
    renderConversationList();
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
    renderConversationList();
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
        replyToId: activeReplyTarget?.id || null,
    });
    messageInput.value = "";
    clearReplyTarget();
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

function truncateText(text, limit = 120) {
    const value = safeText(text).trim();
    if (!value) {
        return "";
    }
    if (value.length <= limit) {
        return value;
    }
    return `${value.slice(0, limit)}...`;
}

function formatReplySnippet(reply) {
    if (!reply) {
        return "";
    }
    const replyType = safeText(reply.message_type || "text").toLowerCase();
    if (replyType === "image") {
        return "[图片]";
    }
    if (replyType === "file") {
        const name = safeText(reply.file_name || "");
        return name ? `[文件] ${name}` : "[文件]";
    }
    return truncateText(reply.message || "", 120);
}

function findMessageRowById(messageId) {
    if (!Number.isFinite(messageId) || messageId <= 0) {
        return null;
    }
    return document.querySelector(`.message-row[data-id="${messageId}"]`);
}

function jumpToReferencedMessage(messageId) {
    const rowElement = findMessageRowById(messageId);
    if (!rowElement) {
        showError("被引用消息未加载，无法跳转");
        return;
    }

    rowElement.scrollIntoView({ behavior: "auto", block: "center" });
    rowElement.classList.add("referenced-highlight");
    setTimeout(() => {
        rowElement.classList.remove("referenced-highlight");
    }, 1500);
}

function resolveReplyData(data) {
    if (!data) {
        return null;
    }

    const direct = data.reply_to || data.replyTo;
    if (direct && direct.username) {
        return {
            username: safeText(direct.username),
            message: safeText(direct.message || ""),
            message_type: safeText(
                direct.message_type || direct.messageType || "text",
            ),
            file_name: safeText(direct.file_name || direct.fileName || ""),
        };
    }

    const replyIdRaw = data.reply_to_id ?? data.replyToId;
    const replyId = Number(replyIdRaw);
    if (!Number.isFinite(replyId) || replyId <= 0) {
        return null;
    }

    const cached = messagePayloadById.get(replyId);
    if (!cached) {
        return {
            username: "消息",
            message: `#${replyId}`,
            message_type: "text",
            file_name: "",
        };
    }

    return {
        username: safeText(cached.username),
        message: safeText(cached.message || ""),
        message_type: safeText(cached.message_type || "text"),
        file_name: safeText(cached.file_name || ""),
    };
}

function resolveReplyId(data) {
    const directId = Number(data?.reply_to?.id ?? data?.replyTo?.id);
    if (Number.isFinite(directId) && directId > 0) {
        return directId;
    }

    const raw = Number(data?.reply_to_id ?? data?.replyToId);
    if (!Number.isFinite(raw) || raw <= 0) {
        return null;
    }
    return raw;
}

function setReplyTarget(target) {
    if (!target || !target.id) {
        clearReplyTarget();
        return;
    }
    activeReplyTarget = target;
    if (replyPreview) {
        replyPreview.hidden = false;
    }
    if (replyPreviewUser) {
        const name = safeText(target.username || "");
        replyPreviewUser.textContent = name ? `${name}:` : "";
    }
    if (replyPreviewSnippet) {
        replyPreviewSnippet.textContent = formatReplySnippet(target);
    }
}

function clearReplyTarget() {
    activeReplyTarget = null;
    if (replyPreview) {
        replyPreview.hidden = true;
    }
    if (replyPreviewUser) {
        replyPreviewUser.textContent = "";
    }
    if (replyPreviewSnippet) {
        replyPreviewSnippet.textContent = "";
    }
}

function isImageFile(file) {
    if (!file) {
        return false;
    }
    if (file.type && file.type.startsWith("image/")) {
        return true;
    }
    const name = file.name || "";
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

function resolveImageSourceSize(data) {
    const widthRaw = Number(data?.image_width ?? data?.imageWidth ?? 0);
    const heightRaw = Number(data?.image_height ?? data?.imageHeight ?? 0);
    const width = Math.floor(widthRaw);
    const height = Math.floor(heightRaw);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
    }
    if (width <= 0 || height <= 0) {
        return null;
    }
    return { width, height };
}

function computeImageRenderSize(sourceWidth, sourceHeight) {
    const viewportWidth = window.visualViewport
        ? Math.floor(window.visualViewport.width)
        : Math.floor(window.innerWidth);
    const maxWidthByViewport = Math.min(320, Math.floor(viewportWidth * 0.58));
    const maxWidthByContainer = messagesContainer
        ? Math.floor(messagesContainer.clientWidth * 0.72)
        : maxWidthByViewport;
    const maxWidth = Math.max(
        1,
        Math.min(maxWidthByViewport, maxWidthByContainer),
    );
    const maxHeight = 280;

    let nextWidth = sourceWidth;
    let nextHeight = sourceHeight;
    const scale = Math.min(maxWidth / nextWidth, maxHeight / nextHeight, 1);

    nextWidth = Math.max(1, Math.floor(nextWidth * scale));
    nextHeight = Math.max(1, Math.floor(nextHeight * scale));
    return { width: nextWidth, height: nextHeight };
}

function applyImageReservedSlot(imageElement, data) {
    const sourceSize = resolveImageSourceSize(data);
    if (!sourceSize) {
        return false;
    }

    const renderSize = computeImageRenderSize(
        sourceSize.width,
        sourceSize.height,
    );
    imageElement.style.width = `${renderSize.width}px`;
    imageElement.style.maxWidth = "100%";
    imageElement.style.height = "auto";
    imageElement.style.aspectRatio = `${sourceSize.width} / ${sourceSize.height}`;
    return true;
}

function applyImageSlotFromNaturalSize(imageElement) {
    if (!imageElement) {
        return;
    }
    const naturalWidth = Number(imageElement.naturalWidth || 0);
    const naturalHeight = Number(imageElement.naturalHeight || 0);
    if (naturalWidth <= 0 || naturalHeight <= 0) {
        return;
    }

    return applyImageReservedSlot(imageElement, {
        image_width: naturalWidth,
        image_height: naturalHeight,
    });
}

function openImagePreview(url, name = "") {
    if (!imagePreviewModal || !imagePreviewTarget) {
        return;
    }
    imagePreviewTarget.src = url;
    imagePreviewTarget.alt = name ? `${name}` : "图片预览";
    if (imagePreviewName) {
        imagePreviewName.textContent = name || "";
    }
    imagePreviewModal.hidden = false;
    imagePreviewModal.setAttribute("aria-hidden", "false");
}

function closeImagePreview() {
    if (!imagePreviewModal || !imagePreviewTarget) {
        return;
    }
    imagePreviewModal.hidden = true;
    imagePreviewModal.setAttribute("aria-hidden", "true");
    imagePreviewTarget.removeAttribute("src");
    if (imagePreviewName) {
        imagePreviewName.textContent = "";
    }
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

    const effectiveUploadKind =
        uploadKind === "file" && isImageFile(file) ? "image" : uploadKind;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("uploadKind", effectiveUploadKind);
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
                imageWidth: payload.imageWidth,
                imageHeight: payload.imageHeight,
                conversationType: activeConversation.conversationType,
                peerUsername: activeConversation.peerUsername,
                replyToId: activeReplyTarget?.id || null,
                message: "",
            });
            clearReplyTarget();
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

function requestMessages(options = {}) {
    if (!isSocketConnected) {
        return;
    }

    if (currentSyncRequest) {
        queuedMessageSync = true;
        return;
    }

    const activeConversation = getActiveConversation();
    const overrideLastIdRaw = options?.lastId;
    const overrideLastId = Number(overrideLastIdRaw);
    const effectiveLastId = Number.isFinite(overrideLastId)
        ? Math.max(0, Math.floor(overrideLastId))
        : lastMessageId;
    const requestId = `${Date.now()}-${++syncRequestSequence}`;

    queuedMessageSync = false;
    pendingRealtimeMessages = [];
    if (syncTimeoutId !== null) {
        clearTimeout(syncTimeoutId);
        syncTimeoutId = null;
    }

    const retryCountRaw = Number(options?.retryCount);
    const retryCount = Number.isFinite(retryCountRaw)
        ? Math.max(0, Math.floor(retryCountRaw))
        : 0;

    currentSyncRequest = {
        requestId,
        startLastId: effectiveLastId,
        receivedCount: 0,
        messages: [],
        conversationKey: activeConversationKey,
        retryCount,
    };

    syncTimeoutId = setTimeout(() => {
        if (!currentSyncRequest || currentSyncRequest.requestId !== requestId) {
            return;
        }

        const timeoutStartLastId = currentSyncRequest.startLastId;
        const timeoutRetryCount = currentSyncRequest.retryCount;
        currentSyncRequest = null;
        pendingRealtimeMessages = [];
        syncTimeoutId = null;

        if (timeoutRetryCount >= MESSAGE_SYNC_MAX_RETRIES) {
            queuedMessageSync = false;
            showError("网络波动，消息同步重试失败，请稍后自动恢复");
            return;
        }

        requestMessages({
            lastId: timeoutStartLastId,
            retryCount: timeoutRetryCount + 1,
        });
    }, MESSAGE_SYNC_TIMEOUT_MS);

    socket.emit("check_messages", {
        requestId,
        lastId: effectiveLastId,
        conversationType: activeConversation.conversationType,
        peerUsername: activeConversation.peerUsername,
    });
}

function renderMessagePayload(data, options = {}) {
    const shouldAutoScroll = Boolean(options.shouldAutoScroll);

    if (typeof data.id === "number") {
        const existing = document.querySelector(
            `.message-row[data-id="${data.id}"]`,
        );
        if (existing) {
            return false;
        }
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
        messagePayloadById.set(data.id, data);
        lastMessageId = Math.max(lastMessageId, data.id);
    }

    if (shouldAutoScroll) {
        scheduleScrollToBottom();
    }
    return true;
}

function renderMessagesInOrder(messages, options = {}) {
    if (!Array.isArray(messages) || !messages.length) {
        return;
    }

    const sorted = [...messages].sort((a, b) => {
        const aId = Number(a?.id || 0);
        const bId = Number(b?.id || 0);
        return aId - bId;
    });

    let renderedCount = 0;
    sorted.forEach((item) => {
        if (renderMessagePayload(item, { shouldAutoScroll: false })) {
            renderedCount += 1;
        }
    });

    if (renderedCount > 0 && options.shouldAutoScroll) {
        scheduleScrollToBottom();
    }
}

function resolveIncomingConversation(data, options = {}) {
    const markUnread = Boolean(options.markUnread);
    const incomingConversation = normalizeIncomingConversation(data);
    if (!incomingConversation) {
        return null;
    }

    const isActiveConversation =
        incomingConversation.key === activeConversationKey;
    if (!isActiveConversation) {
        if (markUnread) {
            increaseConversationUnreadCount(incomingConversation.key, 1);
        }
        renderConversationList();
        return null;
    }

    return incomingConversation;
}

function isCurrentSyncPayload(payload) {
    if (!currentSyncRequest) {
        return false;
    }

    const incomingConversation = normalizeIncomingConversation(payload || {});
    if (!incomingConversation) {
        return false;
    }

    const payloadRequestId = safeText(
        payload?.request_id || payload?.requestId,
    );
    if (
        !payloadRequestId ||
        payloadRequestId !== currentSyncRequest.requestId
    ) {
        return false;
    }

    return incomingConversation.key === currentSyncRequest.conversationKey;
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function scheduleScrollToBottom(options = {}) {
    const force = Boolean(options.force);
    if (!force && !startupAutoScrollEnabled) {
        return;
    }

    scrollToBottom();
    updateNewMessagesIndicator();
}

socket.on("message", function (data) {
    const isIncomingFromOtherUser = safeText(data?.username) !== username;
    const incomingConversation = resolveIncomingConversation(data, {
        markUnread: isIncomingFromOtherUser,
    });
    if (!incomingConversation) {
        return;
    }

    if (isIncomingFromOtherUser) {
        increaseActiveConversationPendingMessages(1);
    }

    if (
        currentSyncRequest &&
        incomingConversation.key === currentSyncRequest.conversationKey
    ) {
        pendingRealtimeMessages.push(data);
        return;
    }

    renderMessagesInOrder([data], {
        shouldAutoScroll: false,
    });

    if (!isIncomingFromOtherUser) {
        scheduleScrollToBottom({ force: true });
    }
});

socket.on("messages_batch", (payload) => {
    if (!isCurrentSyncPayload(payload)) {
        return;
    }

    const batch = Array.isArray(payload?.messages) ? payload.messages : [];
    currentSyncRequest.receivedCount += batch.length;
    currentSyncRequest.messages.push(...batch);
});

socket.on("messages_sync_complete", (payload) => {
    if (!isCurrentSyncPayload(payload)) {
        return;
    }

    const count = Number(payload?.count || 0);
    const limit = Number(payload?.limit || MESSAGE_SYNC_FALLBACK_LIMIT);
    const startLastId = currentSyncRequest.startLastId;
    const receivedCount = currentSyncRequest.receivedCount;
    const retryCount = currentSyncRequest.retryCount;

    if (syncTimeoutId !== null) {
        clearTimeout(syncTimeoutId);
        syncTimeoutId = null;
    }

    if (count > receivedCount) {
        currentSyncRequest = null;
        pendingRealtimeMessages = [];
        if (retryCount >= MESSAGE_SYNC_MAX_RETRIES) {
            queuedMessageSync = false;
            showError("网络波动，消息同步重试失败，请稍后自动恢复");
            return;
        }
        requestMessages({ lastId: startLastId, retryCount: retryCount + 1 });
        return;
    }

    const merged = [...currentSyncRequest.messages, ...pendingRealtimeMessages];
    currentSyncRequest = null;
    pendingRealtimeMessages = [];

    renderMessagesInOrder(merged, {
        shouldAutoScroll: false,
    });

    if (count >= limit && limit > 0) {
        requestMessages();
        return;
    }

    if (queuedMessageSync) {
        requestMessages();
        return;
    }

    if (isHydratingConversation) {
        isHydratingConversation = false;
        scheduleScrollToBottom({ force: true });
        clearActiveConversationPendingMessages({ markRead: true });
        if (!hasCompletedStartupHydration) {
            startupAutoScrollEnabled = false;
            hasCompletedStartupHydration = true;
        }
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

    const replyId = resolveReplyId(data);
    const replyData = resolveReplyData(data);
    if (replyData && replyData.username) {
        bubbleElement.classList.add("has-reply");
        bubbleElement.appendChild(createReplyQuoteElement(replyData, replyId));
    }

    if (messageType === "image" && data.file_url) {
        bubbleElement.classList.add("image-only-bubble");
        const shouldStickBottomAfterLoad =
            isOwn || isHydratingConversation || isMessagesViewNearBottom(64);
        const imageButton = document.createElement("button");
        imageButton.type = "button";
        imageButton.className = "image-preview-trigger";
        imageButton.setAttribute("aria-label", "查看图片");

        const imageElement = document.createElement("img");
        imageElement.className = "message-image";
        applyImageReservedSlot(imageElement, data);
        imageElement.src = data.file_url;
        imageElement.alt = safeText(data.file_name || "图片消息");
        imageElement.loading = "lazy";
        imageElement.addEventListener("load", () => {
            applyImageSlotFromNaturalSize(imageElement);
            if (shouldStickBottomAfterLoad) {
                scheduleScrollToBottom({ force: true });
            }
        });

        imageButton.addEventListener("click", () => {
            openImagePreview(data.file_url, safeText(data.file_name || ""));
        });

        imageButton.appendChild(imageElement);
        bubbleElement.appendChild(imageButton);
    } else if (messageType === "file" && data.file_url) {
        bubbleElement.classList.add("file-only-bubble");
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

    const canEdit = canEditMessage(data);
    const canDelete = canDeleteMessage(data);
    if (typeof data.id === "number") {
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

        const replyButton = document.createElement("button");
        replyButton.type = "button";
        replyButton.className = "message-menu-item";
        replyButton.textContent = "回复";
        replyButton.addEventListener("click", (event) => {
            event.stopPropagation();
            closeActiveMessageMenu();
            setReplyTarget({
                id: data.id,
                username: safeText(data.username),
                message: safeText(data.message),
                message_type: messageTypeForActions,
                file_name: safeText(data.file_name || ""),
            });
            if (messageInput) {
                messageInput.focus();
            }
        });

        menuElement.appendChild(replyButton);

        if (canEdit && messageTypeForActions === "text") {
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

        if (canDelete) {
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "message-menu-item danger";
            deleteButton.textContent = "删除";
            deleteButton.addEventListener("click", (event) => {
                event.stopPropagation();
                closeActiveMessageMenu();
                requestDeleteMessage(data.id);
            });

            menuElement.appendChild(deleteButton);
        }

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

if (imagePreviewCloseButton) {
    imagePreviewCloseButton.addEventListener("click", closeImagePreview);
}

if (imagePreviewModal) {
    imagePreviewModal.addEventListener("click", (event) => {
        if (event.target === imagePreviewModal) {
            closeImagePreview();
        }
    });
}

if (replyPreviewCancelButton) {
    replyPreviewCancelButton.addEventListener("click", clearReplyTarget);
}

if (newMessagesIndicator) {
    newMessagesIndicator.addEventListener("click", () => {
        const shouldMarkRead = activeConversationPendingMessages > 0;
        scheduleScrollToBottom({ force: true });
        if (shouldMarkRead) {
            clearActiveConversationPendingMessages({ markRead: true });
        }
    });
}

setInterval(() => {
    requestMessages();
}, 5000);

window.onload = async function () {
    setAppHeight();
    isMobileMode = detectMobileMode();
    mobileSidebarVisible = isMobileMode;
    applySidebarLayoutState();

    buildConversationList();
    await hydratePrivateConversations();
    await hydrateUnreadCounts();
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
        if (imagePreviewModal && !imagePreviewModal.hidden) {
            closeImagePreview();
            return;
        }
        if (privateChatModal && !privateChatModal.hidden) {
            closePrivateChatModal();
            return;
        }
        closeActiveMessageMenu();
    }
});

window.addEventListener("resize", () => {
    setAppHeight();
    refreshViewportSidebarMode();
    if (activeMessageMenu && activeMessageMenu.classList.contains("open")) {
        adjustMessageMenuDirection(activeMessageMenu);
    }
});

if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", setAppHeight);
    window.visualViewport.addEventListener("scroll", setAppHeight);
}

if (messageInput) {
    messageInput.addEventListener("focus", () => {
        setAppHeight();
        setTimeout(setAppHeight, 300);
    });
    messageInput.addEventListener("blur", () => {
        setAppHeight();
    });
}

if (messagesContainer) {
    messagesContainer.addEventListener("scroll", () => {
        if (
            activeConversationPendingMessages > 0 &&
            isMessagesViewNearBottom()
        ) {
            clearActiveConversationPendingMessages({ markRead: true });
        }
        updateNewMessagesIndicator();
    });
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

function createReplyQuoteElement(reply, replyId = null) {
    const replyElement = document.createElement("div");
    replyElement.className = "reply-quote";

    const userElement = document.createElement("span");
    userElement.className = "reply-quote-username";
    userElement.textContent = safeText(reply.username || "");

    const separatorElement = document.createElement("span");
    separatorElement.textContent = ": ";

    const snippetElement = document.createElement("span");
    snippetElement.textContent = formatReplySnippet(reply);

    replyElement.append(userElement, separatorElement, snippetElement);

    if (Number.isFinite(replyId) && replyId > 0) {
        replyElement.title = "点击跳转到被引用消息";
        replyElement.addEventListener("click", (event) => {
            event.stopPropagation();
            jumpToReferencedMessage(replyId);
        });
    }

    return replyElement;
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
