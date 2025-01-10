// 连接到Socket.IO服务器
const socket = io();

let lastMessageId = 0, lastMessageUsername = null;

// 消息容器
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

// 发送消息
function sendMessage() {
    const message = messageInput.value.trim();
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
    // 转换UTC时间为本地时间
    const utc_timestamp = new Date(data.timestamp);
    const date = new Date(utc_timestamp.getTime() - utc_timestamp.getTimezoneOffset() * 60000);
    const transformed_timestamp = date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(/\//g, '-');
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.innerHTML = (lastMessageUsername === data.username ?`
        <span class="username">${data.username}</span>
    ` : ``) + 
    `   <span class="timestamp">${transformed_timestamp}</span>
        <p class="content">${data.message}</p>
    `;
    lastMessageId = data.id;
    lastMessageUsername = data.username;
    // 将新消息添加到底部
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
});

// 监听事件
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', function (event) {
    if (event.key === 'Enter') {
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