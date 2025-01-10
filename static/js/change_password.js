async function handleChangePassword(event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if(newPassword !== confirmPassword){
        showError('两次输入的密码不一致');
        return;
    }

    try {
        const response = await fetch('/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Bearer ' + localStorage.getItem('token')
            },
            body: `username=${encodeURIComponent(username)}&old_password=${encodeURIComponent(oldPassword)}&new_password=${encodeURIComponent(newPassword)}`
        });

        const data = await response.json();

        if (response.ok) {
            // 修改成功
            window.location.href = data.redirect;
        } else {
            // 显示错误信息
            showError(data.error);
        }
    } catch (error) {
        showError('发生错误,请重试');
    }
}