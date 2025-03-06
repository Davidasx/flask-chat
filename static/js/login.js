async function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const remember = document.getElementById('remember').checked;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: username,
                password: password,
                remember: remember
            })
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