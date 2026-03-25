const avatarFileInput = document.getElementById("avatar-file");
const cropImage = document.getElementById("crop-image");
const cropperWrap = document.getElementById("cropper-wrap");
const resetAvatarBtn = document.getElementById("reset-avatar-btn");
const currentAvatar = document.getElementById("current-avatar");

let cropper = null;

avatarFileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) {
        return;
    }

    if (file.size > 3 * 1024 * 1024) {
        showError("文件过大，请选择不超过 3MB 的图片");
        avatarFileInput.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        cropImage.src = reader.result;
        cropperWrap.style.display = "block";

        if (cropper) {
            cropper.destroy();
        }

        cropper = new Cropper(cropImage, {
            aspectRatio: 1,
            viewMode: 1,
            dragMode: "move",
            autoCropArea: 1,
            responsive: true,
            background: false,
        });
    };
    reader.readAsDataURL(file);
});

async function handleAvatarSave(event) {
    event.preventDefault();

    if (!cropper) {
        showError("请先选择图片并完成裁剪");
        return false;
    }

    const blob = await new Promise((resolve) => {
        cropper
            .getCroppedCanvas({ width: 256, height: 256, fillColor: "#ffffff" })
            .toBlob(resolve, "image/png", 0.92);
    });

    if (!blob) {
        showError("裁剪失败，请重试");
        return false;
    }

    const formData = new FormData();
    formData.append("avatar", blob, "avatar.png");

    try {
        const response = await fetch("/avatar-settings", {
            method: "POST",
            body: formData,
        });

        const data = await response.json();
        if (response.ok) {
            setFlashMessage(data.message || "头像设置成功", "success");
            window.location.href = data.redirect;
        } else {
            showError(data.error || "上传失败，请稍后重试");
        }
    } catch (error) {
        showError("上传失败，请检查网络后重试");
    }

    return false;
}

resetAvatarBtn.addEventListener("click", async () => {
    const formData = new FormData();
    formData.append("action", "reset");

    try {
        const response = await fetch("/avatar-settings", {
            method: "POST",
            body: formData,
        });
        const data = await response.json();

        if (response.ok) {
            setFlashMessage(data.message || "已恢复默认头像", "success");
            currentAvatar.src = defaultAvatarUrl;
            if (cropper) {
                cropper.destroy();
                cropper = null;
            }
            cropperWrap.style.display = "none";
            avatarFileInput.value = "";
            window.location.href = data.redirect;
        } else {
            showError(data.error || "恢复默认头像失败");
        }
    } catch (error) {
        showError("恢复默认头像失败");
    }
});
