const FLASH_MESSAGE_KEY = "ui_flash_message";

function showNotice(message, type = "error", duration = 5000) {
    const messageElement = document.getElementById("error-message");
    if (!messageElement || !message) {
        return;
    }

    messageElement.textContent = message;
    messageElement.classList.remove(
        "notice-error",
        "notice-success",
        "notice-info",
    );
    messageElement.classList.add(`notice-${type}`);
    messageElement.style.display = "block";

    setTimeout(() => {
        messageElement.style.display = "none";
    }, duration);
}

function showError(message) {
    showNotice(message, "error");
}

function showSuccess(message) {
    showNotice(message, "success");
}

function setFlashMessage(message, type = "success") {
    if (!message) {
        return;
    }

    sessionStorage.setItem(
        FLASH_MESSAGE_KEY,
        JSON.stringify({
            message,
            type,
            createdAt: Date.now(),
        }),
    );
}

function consumeFlashMessage() {
    const raw = sessionStorage.getItem(FLASH_MESSAGE_KEY);
    if (!raw) {
        return;
    }

    sessionStorage.removeItem(FLASH_MESSAGE_KEY);

    try {
        const payload = JSON.parse(raw);
        if (!payload?.message) {
            return;
        }
        showNotice(payload.message, payload.type || "success");
    } catch {
        return;
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", consumeFlashMessage);
} else {
    consumeFlashMessage();
}
