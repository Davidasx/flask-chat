// 连接到Socket.IO服务器
const socket = io();

// 消息容器
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

// 发送消息
function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('message', { message: message });
        messageInput.value = '';
    }
}

// 自动滚动到最新消息
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 接收消息
socket.on('message', function (data) {
    lastMessageId = data.id;
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.innerHTML = `
        <span class="username">${data.username}</span>
        <span class="timestamp">${data.timestamp}</span>
        <p class="content">${data.message}</p>
    `;
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

// 修改定时检查逻辑
let lastMessageId = 0;

// 定期检查新消息
setInterval(() => {
    socket.emit('check_messages', { lastId: lastMessageId });
}, 5000);

// 初始加载完成后滚动到底部
window.onload = function () {
    scrollToBottom();
};