import sqlite3
from config import config

db_path = config.get('database', 'chat.db')

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
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # 创建用户表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                email TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    close_db_connection(conn)

def add_user(username, password):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                'INSERT INTO users (username, password) VALUES (?, ?)',
                (username, password)
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
    try:
        with conn:
            conn.execute(
                'UPDATE users SET password = ? WHERE username = ?',
                (password, username)
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

def verify_user(username, password):
    conn = get_db_connection()
    user = conn.execute(
        'SELECT * FROM users WHERE username = ? AND password = ?',
        (username, password)
    ).fetchone()
    close_db_connection(conn)
    return user

def verified_email(username):
    conn = get_db_connection()
    user = conn.execute(
        'SELECT * FROM users WHERE username = ? AND email IS NOT NULL',
        (username,)
    ).fetchone()
    close_db_connection(conn)
    return user

def get_messages(last_id=0, limit=50):
    try:
        conn = get_db_connection()
        messages = conn.execute(
            'SELECT * FROM messages WHERE id > ? ORDER BY timestamp ASC LIMIT ?', 
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
                'INSERT INTO messages (username, message) VALUES (?, ?)', 
                (username, message)
            )
        close_db_connection(conn)
        return True
    except Exception as e:
        print(f"Error adding message: {e}")
        return False