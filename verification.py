from config import config
import resend

site_name = config.get('site_name')
resend_api_key = config.get('verification_sender').get('resend_api_key')
sender_email = config.get('verification_sender').get('sender_email')
recipient_domain = config.get('verification_sender').get('recipient_domain')

def send_verification_email(recipient_email, captcha):
    domain = recipient_email.split('@')[1]
    if domain != recipient_domain and recipient_domain != '*':
        return -1
    
    # 发送验证码
    resend.api_key = resend_api_key

    params: resend.Emails.SendParams = {
        "from": f"{site_name} <{sender_email}>",
        "to": [recipient_email],
        "subject": f"{site_name}注册",
        "html": f"<p>欢迎注册{site_name}！您的初始密码为{captcha}，请勿外传。如非本人操作，请忽略此信息。</p>",
    }

    try:
        email = resend.Emails.send(params)
        return 0
    except:
        return -2