async function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
        });

        const data = await response.json();

        if (response.ok) {
            // 登录成功
            window.location.href = data.redirect;
        } else {
            // 显示错误信息
            showError(data.error);
        }
    } catch (error) {
        showError('登录过程中发生错误,请重试');
    }
}