import sqlite3
from config import config
import datetime
import jwt
from werkzeug.security import generate_password_hash, check_password_hash

db_path = config.get('database', 'chat.db')


def _is_hashed_password(password):
    return isinstance(password, str) and (password.startswith('pbkdf2:') or password.startswith('scrypt:'))

def get_db_connection():
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def close_db_connection(conn):
    if conn:
        conn.close()

def init_db():
    conn = get_db_connection()
    with conn:
        # 创建消息表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                message TEXT NOT NULL,
                timestamp DATETIME
            )
        ''')
        
        # 创建用户表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                email TEXT DEFAULT NULL,
                avatar_url TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # 兼容旧版本数据库：补充 avatar_url 字段
        columns = conn.execute('PRAGMA table_info(users)').fetchall()
        column_names = {column['name'] for column in columns}
        if 'avatar_url' not in column_names:
            conn.execute('ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL')

        # 创建会话表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                token TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    close_db_connection(conn)

# 新增会话
def add_session(username, token):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                'INSERT INTO sessions (username, token) VALUES (?, ?)',
                (username, token)
            )
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        close_db_connection(conn)

# 移除会话
def remove_session(username, token):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                'DELETE FROM sessions WHERE username = ? AND token = ?',
                (username, token)
            )
        return True
    except Exception as e:
        print(f"Error removing session: {e}")
        return False
    finally:
        close_db_connection(conn)

def get_sessions(username):
    conn = get_db_connection()
    sessions = conn.execute(
        'SELECT * FROM sessions WHERE username = ?',
        (username,)
    ).fetchall()
    close_db_connection(conn)
    return sessions

# 测试会话是否有效
def verify_session(username, token):
    conn = get_db_connection()
    session = conn.execute(
        'SELECT * FROM sessions WHERE username = ? AND token = ?',
        (username, token)
    ).fetchone()
    close_db_connection(conn)
    if session is None:
        return False
    
    try:
        # 解码JWT token
        payload = jwt.decode(token, config.get('secret_key'), algorithms=["HS256"])
        username = payload.get('username')
    except:
        remove_session(username, token)
        return False
    
    return True

def add_user(username, password):
    conn = get_db_connection()
    hashed_password = generate_password_hash(password)
    try:
        with conn:
            conn.execute(
                'INSERT INTO users (username, password) VALUES (?, ?)',
                (username, hashed_password)
            )
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        close_db_connection(conn)

def user_exists(username):
    conn = get_db_connection()
    user = conn.execute(
        'SELECT * FROM users WHERE username = ?',
        (username,)
    ).fetchone()
    close_db_connection(conn)
    return user is not None

def email_used(email):
    conn = get_db_connection()
    user = conn.execute(
        'SELECT * FROM users WHERE email = ?',
        (email,)
    ).fetchone()
    close_db_connection(conn)
    return user is not None

def update_password(username, password):
    conn = get_db_connection()
    hashed_password = generate_password_hash(password)
    try:
        with conn:
            conn.execute(
                'UPDATE users SET password = ? WHERE username = ?',
                (hashed_password, username)
            )
        return True
    except Exception as e:
        print(f"Error updating password: {e}")
        return False
    finally:
        close_db_connection(conn)

def get_email(username):
    conn = get_db_connection()
    email = conn.execute(
        'SELECT email FROM users WHERE username = ?',
        (username,)
    ).fetchone()
    close_db_connection(conn)
    return email['email'] if email else None

def update_email(username, email):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                'UPDATE users SET email = ? WHERE username = ?',
                (email, username)
            )
        return True
    except Exception as e:
        print(f"Error updating email: {e}")
        return False
    finally:
        close_db_connection(conn)

def get_user(username):
    conn = get_db_connection()
    user = conn.execute(
        'SELECT * FROM users WHERE username = ?',
        (username,)
    ).fetchone()
    close_db_connection(conn)
    return user


def get_avatar_url(username):
    conn = get_db_connection()
    avatar = conn.execute(
        'SELECT avatar_url FROM users WHERE username = ?',
        (username,)
    ).fetchone()
    close_db_connection(conn)
    return avatar['avatar_url'] if avatar else None


def update_avatar_url(username, avatar_url):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                'UPDATE users SET avatar_url = ? WHERE username = ?',
                (avatar_url, username)
            )
        return True
    except Exception as e:
        print(f"Error updating avatar: {e}")
        return False
    finally:
        close_db_connection(conn)

def verify_user(username, password):
    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT * FROM users WHERE username = ?',
            (username,)
        ).fetchone()

        if not user:
            return None

        stored_password = user['password']
        if _is_hashed_password(stored_password):
            if check_password_hash(stored_password, password):
                return user
            return None

        if stored_password == password:
            with conn:
                conn.execute(
                    'UPDATE users SET password = ? WHERE username = ?',
                    (generate_password_hash(password), username)
                )
            return user

        return None
    finally:
        close_db_connection(conn)

def verified_email(username):
    conn = get_db_connection()
    user = conn.execute(
        'SELECT * FROM users WHERE username = ? AND email IS NOT NULL',
        (username,)
    ).fetchone()
    close_db_connection(conn)
    return user

def get_last_message():
    try:
        conn = get_db_connection()
        message = conn.execute(
            '''
            SELECT messages.*, users.avatar_url AS avatar_url
            FROM messages
            LEFT JOIN users ON users.username = messages.username
            ORDER BY messages.id DESC
            LIMIT 1
            '''
        ).fetchone()
        close_db_connection(conn)
        return message
    except Exception as e:
        return None

def get_messages(last_id=0, limit=50, timezone_offset=0):
    try:
        conn = get_db_connection()
        messages = conn.execute(
            '''
            SELECT messages.*, users.avatar_url AS avatar_url
            FROM messages
            LEFT JOIN users ON users.username = messages.username
            WHERE messages.id > ?
            ORDER BY messages.timestamp ASC
            LIMIT ?
            ''',
            (last_id, limit)
        ).fetchall()
        close_db_connection(conn)
        return messages
    except Exception as e:
        return []

def add_message(username, message):
    try:
        conn = get_db_connection()
        with conn:
            cursor = conn.execute(
                'INSERT INTO messages (username, message, timestamp) VALUES (?, ?, ?)', 
                (username, message, datetime.datetime.utcnow())
            )
        close_db_connection(conn)
        return datetime.datetime.utcnow()
    except Exception as e:
        print(f"Error adding message: {e}")
        return -1