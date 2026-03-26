document
    .getElementById("admin-login-form")
    .addEventListener("submit", async function (event) {
        event.preventDefault();

        const password = document.getElementById("admin-password").value.trim();
        if (!password) {
            showError("请输入授权密码");
            return;
        }

        try {
            const response = await fetch("/admin/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });

            const data = await response.json();
            if (!response.ok) {
                showError(data.error || "授权失败");
                return;
            }

            setFlashMessage(data.message || "授权成功", "success");
            window.location.href = data.redirect || "/admin";
        } catch {
            showError("请求失败，请稍后重试");
        }
    });
