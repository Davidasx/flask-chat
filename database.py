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
                conversation_type TEXT NOT NULL DEFAULT 'public',
                peer_username TEXT DEFAULT NULL,
                message_type TEXT NOT NULL DEFAULT 'text',
                file_url TEXT DEFAULT NULL,
                file_name TEXT DEFAULT NULL,
                file_size INTEGER DEFAULT NULL,
                file_mime TEXT DEFAULT NULL,
                timestamp DATETIME,
                edited_at DATETIME DEFAULT NULL
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
                is_admin INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # 兼容旧版本数据库：补充 avatar_url 字段
        columns = conn.execute('PRAGMA table_info(users)').fetchall()
        column_names = {column['name'] for column in columns}
        if 'avatar_url' not in column_names:
            conn.execute('ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL')
        if 'is_admin' not in column_names:
            conn.execute('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0')

        message_columns = conn.execute('PRAGMA table_info(messages)').fetchall()
        message_column_names = {column['name'] for column in message_columns}
        if 'edited_at' not in message_column_names:
            conn.execute('ALTER TABLE messages ADD COLUMN edited_at DATETIME DEFAULT NULL')
        if 'conversation_type' not in message_column_names:
            conn.execute("ALTER TABLE messages ADD COLUMN conversation_type TEXT NOT NULL DEFAULT 'public'")
        if 'peer_username' not in message_column_names:
            conn.execute('ALTER TABLE messages ADD COLUMN peer_username TEXT DEFAULT NULL')
        if 'message_type' not in message_column_names:
            conn.execute("ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'")
        if 'file_url' not in message_column_names:
            conn.execute('ALTER TABLE messages ADD COLUMN file_url TEXT DEFAULT NULL')
        if 'file_name' not in message_column_names:
            conn.execute('ALTER TABLE messages ADD COLUMN file_name TEXT DEFAULT NULL')
        if 'file_size' not in message_column_names:
            conn.execute('ALTER TABLE messages ADD COLUMN file_size INTEGER DEFAULT NULL')
        if 'file_mime' not in message_column_names:
            conn.execute('ALTER TABLE messages ADD COLUMN file_mime TEXT DEFAULT NULL')

        # 创建会话表
        conn.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                token TEXT NOT NULL,
                user_agent TEXT DEFAULT '',
                ip_address TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        session_columns = conn.execute('PRAGMA table_info(sessions)').fetchall()
        session_column_names = {column['name'] for column in session_columns}
        if 'user_agent' not in session_column_names:
            conn.execute("ALTER TABLE sessions ADD COLUMN user_agent TEXT DEFAULT ''")
        if 'ip_address' not in session_column_names:
            conn.execute("ALTER TABLE sessions ADD COLUMN ip_address TEXT DEFAULT ''")
        if 'last_seen' not in session_column_names:
            conn.execute('ALTER TABLE sessions ADD COLUMN last_seen DATETIME')
            conn.execute('UPDATE sessions SET last_seen = CURRENT_TIMESTAMP WHERE last_seen IS NULL')
    close_db_connection(conn)

# 新增会话
def add_session(username, token, user_agent='', ip_address=''):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                'INSERT INTO sessions (username, token, user_agent, ip_address, last_seen) VALUES (?, ?, ?, ?, ?)',
                (username, token, user_agent or '', ip_address or '', datetime.datetime.utcnow())
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
        'SELECT * FROM sessions WHERE username = ? ORDER BY created_at DESC',
        (username,)
    ).fetchall()
    close_db_connection(conn)
    return sessions


def get_session_by_token(token):
    conn = get_db_connection()
    session_item = conn.execute(
        'SELECT * FROM sessions WHERE token = ?',
        (token,)
    ).fetchone()
    close_db_connection(conn)
    return session_item


def update_session_seen(username, token):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                'UPDATE sessions SET last_seen = ? WHERE username = ? AND token = ?',
                (datetime.datetime.utcnow(), username, token)
            )
        return True
    except Exception as e:
        print(f"Error updating session seen: {e}")
        return False
    finally:
        close_db_connection(conn)


def remove_session_by_token(token):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                'DELETE FROM sessions WHERE token = ?',
                (token,)
            )
        return True
    except Exception as e:
        print(f"Error removing session by token: {e}")
        return False
    finally:
        close_db_connection(conn)


def get_user_sessions(username, exclude_token=None):
    conn = get_db_connection()
    try:
        if exclude_token:
            sessions = conn.execute(
                'SELECT id, username, token, user_agent, ip_address, created_at, last_seen FROM sessions WHERE username = ? AND token != ? ORDER BY last_seen DESC',
                (username, exclude_token)
            ).fetchall()
        else:
            sessions = conn.execute(
                'SELECT id, username, token, user_agent, ip_address, created_at, last_seen FROM sessions WHERE username = ? ORDER BY last_seen DESC',
                (username,)
            ).fetchall()
        return sessions
    finally:
        close_db_connection(conn)


def get_all_sessions(limit=300):
    conn = get_db_connection()
    try:
        sessions = conn.execute(
            '''
            SELECT sessions.id, sessions.username, sessions.token, sessions.user_agent, sessions.ip_address,
                   sessions.created_at, sessions.last_seen, users.is_admin
            FROM sessions
            LEFT JOIN users ON users.username = sessions.username
            ORDER BY sessions.last_seen DESC
            LIMIT ?
            ''',
            (limit,)
        ).fetchall()
        return sessions
    finally:
        close_db_connection(conn)

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


def get_all_usernames(exclude_username=None):
    conn = get_db_connection()
    try:
        if exclude_username:
            users = conn.execute(
                'SELECT username FROM users WHERE username != ? ORDER BY username COLLATE NOCASE ASC',
                (exclude_username,)
            ).fetchall()
        else:
            users = conn.execute(
                'SELECT username FROM users ORDER BY username COLLATE NOCASE ASC'
            ).fetchall()
        return [item['username'] for item in users]
    finally:
        close_db_connection(conn)


def is_admin(username):
    conn = get_db_connection()
    user = conn.execute(
        'SELECT is_admin FROM users WHERE username = ?',
        (username,)
    ).fetchone()
    close_db_connection(conn)
    return bool(user and user['is_admin'])


def set_admin(username, is_admin_flag=True):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                'UPDATE users SET is_admin = ? WHERE username = ?',
                (1 if is_admin_flag else 0, username)
            )
        return True
    except Exception as e:
        print(f"Error setting admin: {e}")
        return False
    finally:
        close_db_connection(conn)


def get_all_users():
    conn = get_db_connection()
    try:
        users = conn.execute(
            '''
            SELECT users.username, users.email, users.is_admin, users.created_at,
                   COUNT(sessions.id) AS session_count
            FROM users
            LEFT JOIN sessions ON sessions.username = users.username
            GROUP BY users.username, users.email, users.is_admin, users.created_at
            ORDER BY users.created_at DESC
            '''
        ).fetchall()
        return users
    finally:
        close_db_connection(conn)


def get_user_count():
    conn = get_db_connection()
    item = conn.execute('SELECT COUNT(*) AS total FROM users').fetchone()
    close_db_connection(conn)
    return int(item['total']) if item else 0


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
            SELECT messages.*, users.avatar_url AS avatar_url, users.is_admin AS is_admin
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
            SELECT messages.*, users.avatar_url AS avatar_url, users.is_admin AS is_admin
            FROM messages
            LEFT JOIN users ON users.username = messages.username
            WHERE messages.id > ? AND messages.conversation_type = 'public'
            ORDER BY messages.timestamp ASC
            LIMIT ?
            ''',
            (last_id, limit)
        ).fetchall()
        close_db_connection(conn)
        return messages
    except Exception as e:
        return []

def add_message(
    username,
    message,
    conversation_type='public',
    peer_username=None,
    message_type='text',
    file_url=None,
    file_name=None,
    file_size=None,
    file_mime=None,
):
    try:
        conn = get_db_connection()
        with conn:
            cursor = conn.execute(
                '''
                INSERT INTO messages (
                    username,
                    message,
                    conversation_type,
                    peer_username,
                    message_type,
                    file_url,
                    file_name,
                    file_size,
                    file_mime,
                    timestamp
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    username,
                    message,
                    conversation_type,
                    peer_username,
                    message_type,
                    file_url,
                    file_name,
                    file_size,
                    file_mime,
                    datetime.datetime.utcnow(),
                )
            )
            message_id = cursor.lastrowid
        close_db_connection(conn)
        return message_id
    except Exception as e:
        print(f"Error adding message: {e}")
        return None


def get_messages_for_conversation(username, conversation_type='public', peer_username=None, last_id=0, limit=50):
    conn = get_db_connection()
    try:
        if conversation_type == 'private' and peer_username:
            messages = conn.execute(
                '''
                SELECT messages.*, users.avatar_url AS avatar_url, users.is_admin AS is_admin
                FROM messages
                LEFT JOIN users ON users.username = messages.username
                WHERE messages.id > ?
                  AND messages.conversation_type = 'private'
                  AND ((messages.username = ? AND messages.peer_username = ?)
                       OR (messages.username = ? AND messages.peer_username = ?))
                ORDER BY messages.timestamp ASC
                LIMIT ?
                ''',
                (last_id, username, peer_username, peer_username, username, limit)
            ).fetchall()
        else:
            messages = conn.execute(
                '''
                SELECT messages.*, users.avatar_url AS avatar_url, users.is_admin AS is_admin
                FROM messages
                LEFT JOIN users ON users.username = messages.username
                WHERE messages.id > ?
                  AND messages.conversation_type = 'public'
                ORDER BY messages.timestamp ASC
                LIMIT ?
                ''',
                (last_id, limit)
            ).fetchall()
        return messages
    finally:
        close_db_connection(conn)


def get_message_by_id(message_id):
    conn = get_db_connection()
    try:
        message = conn.execute(
            '''
            SELECT messages.*, users.avatar_url AS avatar_url, users.is_admin AS is_admin
            FROM messages
            LEFT JOIN users ON users.username = messages.username
            WHERE messages.id = ?
            ''',
            (message_id,)
        ).fetchone()
        return message
    finally:
        close_db_connection(conn)


def update_message(message_id, new_message):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                'UPDATE messages SET message = ?, edited_at = ? WHERE id = ?',
                (new_message, datetime.datetime.utcnow(), message_id)
            )
        return True
    except Exception as e:
        print(f"Error updating message: {e}")
        return False
    finally:
        close_db_connection(conn)


def delete_message(message_id):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute('DELETE FROM messages WHERE id = ?', (message_id,))
        return True
    except Exception as e:
        print(f"Error deleting message: {e}")
        return False
    finally:
        close_db_connection(conn)