// 建立带token的Socket连接
const socket = io();

let lastMessageId = 0, lastMessageUsername = null, mergeBlockTimestamp = null;

// 更新在线状态指示灯
function updateOnlineStatus(status) {
    const indicator = document.querySelector('.online-indicator');
    if (indicator) {
        if (status === 'connected') {
            indicator.classList.remove('offline');
        } else {
            indicator.classList.add('offline');
        }
    }

    // 更新输入框和发送按钮状态
    sendButton.disabled = status === 'disconnected';
}

// 处理强制下线事件
socket.on('force_disconnect', function (data) {
    socket.disconnect();

    // 更新状态指示灯
    updateOnlineStatus('disconnected');

    // 延迟跳转到登录页面
    setTimeout(() => {
        window.location.href = '/login';
    }, 1000);
});

// Socket连接事件
socket.on('connect', () => {
    updateOnlineStatus('connected');
});

socket.on('disconnect', () => {
    updateOnlineStatus('disconnected');
});

// 消息容器
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

// 发送消息
function sendMessage() {
    const message = sanitizeMessage(messageInput.value.trim());
    if (message) {
        socket.emit('send_message', { message: message });
        messageInput.value = '';
    }
}

// 自动滚动到最新消息
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 接收消息
socket.on('message', function (data) {
    if (data.id <= lastMessageId) {
        return;
    }
    // 转换UTC时间为本地时间
    const utc_timestamp = new Date(data.timestamp);
    const date = new Date(utc_timestamp.getTime() - utc_timestamp.getTimezoneOffset() * 60 * 1000);
    const transformed_timestamp = date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(/\//g, '-');

    // 检查是否需要合并消息
    const currentTime = date.getTime();
    const shouldMerge = lastMessageUsername === data.username &&
        mergeBlockTimestamp !== null &&
        new Date(data.timestamp).getTime() - new Date(mergeBlockTimestamp).getTime() <= 10 * 60 * 1000 &&
        messagesContainer.lastElementChild;

    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.innerHTML = messageContent(shouldMerge);
    messagesContainer.appendChild(messageElement);

    addCopyButton(messageElement);

    // 更新合并块时间戳
    mergeBlockTimestamp = data.timestamp;

    lastMessageId = data.id;
    lastMessageUsername = data.username;
    scrollToBottom();

    function messageContent(shouldMerge) {
        if (shouldMerge) return `
            <p class="content">${sanitizeMessage(data.message)}</p>
        `;
        else return `
            <span class="username">${data.username}</span>
            <span class="timestamp">${transformed_timestamp}</span>
            <p class="content">${sanitizeMessage(data.message)}</p>
        `;
    }

    // Function to create and append the button
    function addCopyButton(messageElement) {
        // Create the button
        const copyButton = document.createElement('button');
        copyButton.innerText = 'Copy';

        // Style the button to position it at the top-right
        copyButton.style.position = 'absolute';
        copyButton.style.top = '10px'; // Adjust as needed
        copyButton.style.right = '10px'; // Adjust as needed
        copyButton.style.zIndex = '1'; // Ensure it is above other elements
        // Add event listener to handle copy action
        copyButton.addEventListener('click', () => {
            const paragraph = messageElement.querySelector('p');
            if (paragraph) {
                // Create a temporary textarea element to hold the text
                const textarea = document.createElement('textarea');
                textarea.value = paragraph.innerText;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
        });
        // Append the button to the messageElement
        messageElement.appendChild(copyButton);
    }
    // Call the function to add the button
    addCopyButton();
});

// 监听事件
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', function (event) {
    if (event.key === 'Enter' && !sendButton.disabled) {
        sendMessage();
    }
});

// 定期检查新消息
setInterval(() => {
    socket.emit('check_messages', { lastId: lastMessageId });
}, 5000);

// 初始加载完成后滚动到底部
window.onload = function () {
    scrollToBottom();
};


/* --- MISCS FOR MESSAGE DISPLAY --- */

function sanitizeMessage(message) {
    const tempElement = document.createElement('div');
    tempElement.textContent = message;
    return tempElement.innerText;
}