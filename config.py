import json
import os
import secrets
import copy


DEFAULT_CONFIG = {
    "database": "chat.db",
    "email_verification": False,
    "verification_sender": {
        "resend_api_key": "",
        "sender_email": "user@example.com",
        "recipient_domain": "*"
    },
    "secret_key": "",
    "site_name": "Chat App"
}

WEAK_SECRET_KEYS = {
    "",
    "secret-key-here",
}

class Config:
    def __init__(self):
        self.config_data = {}
        self.load_config()
    
    def load_config(self):
        config_path = os.path.join(os.path.dirname(__file__), 'config.json')
        should_save = False
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                self.config_data = json.load(f)
        except FileNotFoundError:
            self.config_data = copy.deepcopy(DEFAULT_CONFIG)
            should_save = True
        except json.JSONDecodeError:
            self.config_data = copy.deepcopy(DEFAULT_CONFIG)
            should_save = True

        secret_key = str(self.config_data.get("secret_key", "")).strip()
        if secret_key in WEAK_SECRET_KEYS:
            self.config_data["secret_key"] = secrets.token_urlsafe(32)
            should_save = True

        if should_save:
            self.save_config()
    
    def save_config(self):
        config_path = os.path.join(os.path.dirname(__file__), 'config.json')
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(self.config_data, f, indent=4, ensure_ascii=False)
    
    def get(self, key, default=None):
        return self.config_data.get(key, default)

# 创建全局配置实例
config = Config()