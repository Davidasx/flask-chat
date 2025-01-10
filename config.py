import json
import os
import random

class Config:
    def __init__(self):
        self.config_data = {}
        self.load_config()
    
    def load_config(self):
        config_path = os.path.join(os.path.dirname(__file__), 'config.json')
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                self.config_data = json.load(f)
        except FileNotFoundError:
            # 使用默认配置
            # 随机生成密钥
            secret_key = ''.join([random.choice('abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*(-_=+)') for i in range(24)])

            self.config_data = {
                {
                    "database": {
                        "type": "sqlite",
                        "path": "chat.db"
                    },
                    "server": {
                        "host": "0.0.0.0",
                        "port": 5000,
                        "debug": True
                    },
                    "secret_key": secret_key,
                    "site_name": "Chat App"
                }
            }
            # 创建默认配置文件
            self.save_config()
    
    def save_config(self):
        config_path = os.path.join(os.path.dirname(__file__), 'config.json')
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(self.config_data, indent=4, ensure_ascii=False)
    
    def get(self, key, default=None):
        return self.config_data.get(key, default)

# 创建全局配置实例
config = Config()