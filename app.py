from flask import jsonify, Flask, render_template, request, redirect, url_for, session
import jwt
import datetime
import database
from flask_socketio import SocketIO, emit, disconnect
from functools import wraps
from config import config
from threading import Timer
from PIL import Image, UnidentifiedImageError
import os
import uuid

import verification
import random

app = Flask(__name__)
app.config['SECRET_KEY'] = config.get('secret_key')
app.config['SITE_NAME'] = config.get('site_name')
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['MAX_CONTENT_LENGTH'] = 3 * 1024 * 1024
# 初始化 SocketIO
socketio = SocketIO(app, async_mode='threading')

# 存储token和websocket连接的映射
ws_connections = {}

DEFAULT_AVATAR_PATH = '/static/images/default-avatar.svg'
AVATAR_UPLOAD_DIR = os.path.join(app.root_path, 'static', 'uploads', 'avatars')
APP_VERSION = '1.2.2'
MAX_CHAT_MESSAGE_LENGTH = 500
APP_STARTED_AT_UTC = datetime.datetime.utcnow()

database.init_db()


def _normalize_avatar_path(avatar_path):
    return avatar_path if avatar_path else DEFAULT_AVATAR_PATH


def _is_local_avatar(avatar_path):
    return bool(avatar_path) and avatar_path.startswith('/static/uploads/avatars/')


def _delete_local_avatar_file(avatar_path):
    if not _is_local_avatar(avatar_path):
        return

    local_path = os.path.join(app.root_path, avatar_path.lstrip('/'))
    if os.path.exists(local_path):
        os.remove(local_path)


def _normalize_chat_message(raw_message):
    if raw_message is None:
        return ''

    if not isinstance(raw_message, str):
        raw_message = str(raw_message)

    cleaned_message = raw_message.replace('\x00', '').strip()
    if len(cleaned_message) > MAX_CHAT_MESSAGE_LENGTH:
        cleaned_message = cleaned_message[:MAX_CHAT_MESSAGE_LENGTH]

    return cleaned_message


def _save_avatar_image(username, file_storage):
    if not file_storage or not file_storage.filename:
        return None, '请选择要上传的图片'

    try:
        file_storage.stream.seek(0)
        image = Image.open(file_storage.stream)
        image = image.convert('RGBA')
    except (UnidentifiedImageError, OSError):
        return None, '仅支持上传有效图片文件'

    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize((256, 256), Image.Resampling.LANCZOS)

    os.makedirs(AVATAR_UPLOAD_DIR, exist_ok=True)
    filename = f"{username}_{uuid.uuid4().hex}.png"
    absolute_path = os.path.join(AVATAR_UPLOAD_DIR, filename)
    image.save(absolute_path, format='PNG', optimize=True)

    return f"/static/uploads/avatars/{filename}", None


@app.context_processor
def inject_user_context():
    username = session.get('username')
    if not username:
        return {
            'current_user_avatar': DEFAULT_AVATAR_PATH,
            'default_avatar_path': DEFAULT_AVATAR_PATH,
            'app_version': APP_VERSION,
            'static_version': APP_VERSION,
            'current_user_is_admin': False,
        }

    return {
        'current_user_avatar': _normalize_avatar_path(database.get_avatar_url(username)),
        'default_avatar_path': DEFAULT_AVATAR_PATH,
        'app_version': APP_VERSION,
        'static_version': APP_VERSION,
        'current_user_is_admin': database.is_admin(username),
    }


def _is_admin_panel_authorized():
    return bool(session.get('admin_panel_authorized'))


def _get_admin_access_password():
    configured_password = str(config.get('admin_access_password', '') or '').strip()
    if configured_password:
        return configured_password
    return str(config.get('secret_key', '') or '')


def _build_runtime_status():
    uptime_seconds = int((datetime.datetime.utcnow() - APP_STARTED_AT_UTC).total_seconds())
    return {
        'app_version': APP_VERSION,
        'server_time_utc': datetime.datetime.utcnow().isoformat(),
        'uptime_seconds': uptime_seconds,
        'active_ws_connections': len(ws_connections),
        'registered_users': database.get_user_count(),
    }


def admin_panel_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not _is_admin_panel_authorized():
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)

    return decorated_function

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = session.get('token')
        username = session.get('username')

        if not token or not username:
            return redirect(url_for('login'))
            
        if database.verify_session(username, token):
            database.update_session_seen(username, token)
            return f(*args, **kwargs)
        else:
            session.clear()
            return redirect(url_for('login'))
            
    return decorated_function

def no_login_only(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'token' in session:
            return redirect(url_for('chat'))
        return f(*args, **kwargs)
    return decorated_function

# 下线session
def kick_session(username, token):
    # 移除会话
    database.remove_session(username, token)
    # 断开连接
    close_ws_connection(username, token)

# 下线用户
def kick_user(username):
    # 移除所有会话
    sessions = database.get_sessions(username)
    for alive_session in sessions:
        kick_session(username, alive_session['token'])

@app.route('/')
def home():
    return redirect(url_for('chat'))

@app.route('/chat')
@login_required
def chat():
    return render_template(
        'chat.html',
        site_name=app.config['SITE_NAME'],
        user_name=session.get('username'),
        user_avatar=_normalize_avatar_path(database.get_avatar_url(session.get('username'))),
        default_avatar_path=DEFAULT_AVATAR_PATH,
        user_is_admin=database.is_admin(session.get('username'))
    )


@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if request.method == 'POST':
        payload = request.get_json(silent=True) or request.form or {}
        password = str(payload.get('password', '')).strip()
        if not password:
            return jsonify({'error': '请输入授权密码'}), 400

        if password != _get_admin_access_password():
            return jsonify({'error': '授权密码错误'}), 401

        session['admin_panel_authorized'] = True
        return jsonify({'message': '授权成功', 'redirect': url_for('admin_panel')})

    return render_template('admin_login.html', site_name=app.config['SITE_NAME'])


@app.route('/admin/logout', methods=['POST'])
def admin_logout():
    session.pop('admin_panel_authorized', None)
    return jsonify({'message': '已退出管理员面板授权'})


@app.route('/admin')
@admin_panel_required
def admin_panel():
    return render_template('admin.html', site_name=app.config['SITE_NAME'])


@app.route('/admin/api/summary')
@admin_panel_required
def admin_summary_api():
    return jsonify({
        'runtime': _build_runtime_status(),
        'users': [dict(row) for row in database.get_all_users()],
        'sessions': [dict(row) for row in database.get_all_sessions()],
    })


@app.route('/admin/api/set-admin', methods=['POST'])
@admin_panel_required
def admin_set_admin():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get('username', '')).strip()
    admin_enabled = bool(payload.get('is_admin', True))

    if not username:
        return jsonify({'error': '用户名不能为空'}), 400

    if not database.user_exists(username):
        return jsonify({'error': '用户不存在'}), 404

    if not database.set_admin(username, admin_enabled):
        return jsonify({'error': '管理员状态设置失败'}), 500

    return jsonify({'message': f'用户 {username} 管理员状态已更新'})


@app.route('/admin/api/kick-session', methods=['POST'])
@admin_panel_required
def admin_kick_session_api():
    payload = request.get_json(silent=True) or {}
    token = str(payload.get('token', '')).strip()
    if not token:
        return jsonify({'error': '会话标识不能为空'}), 400

    session_item = database.get_session_by_token(token)
    if not session_item:
        return jsonify({'error': '会话不存在'}), 404

    kick_session(session_item['username'], token)
    return jsonify({'message': '会话已强制下线'})


@app.route('/security/sessions')
@login_required
def security_sessions_page():
    return render_template('security_sessions.html', site_name=app.config['SITE_NAME'], user_name=session.get('username'))


@app.route('/security/sessions/list')
@login_required
def security_sessions_list():
    username = session.get('username')
    current_token = session.get('token')
    sessions_data = []
    for item in database.get_user_sessions(username):
        session_dict = dict(item)
        session_dict['is_current'] = session_dict.get('token') == current_token
        sessions_data.append(session_dict)
    return jsonify({'sessions': sessions_data})


@app.route('/security/sessions/kick', methods=['POST'])
@login_required
def security_sessions_kick():
    payload = request.get_json(silent=True) or {}
    token = str(payload.get('token', '')).strip()
    username = session.get('username')

    if not token:
        return jsonify({'error': '会话标识不能为空'}), 400

    if token == session.get('token'):
        return jsonify({'error': '不能终止当前正在使用的会话'}), 400

    target_session = database.get_session_by_token(token)
    if not target_session or target_session['username'] != username:
        return jsonify({'error': '会话不存在或无权限'}), 404

    kick_session(username, token)
    return jsonify({'message': '目标设备会话已下线'})


@app.route('/avatar-settings', methods=['GET', 'POST'])
@login_required
def avatar_settings():
    username = session.get('username')

    if request.method == 'POST':
        action = request.form.get('action', '').strip()
        old_avatar = database.get_avatar_url(username)

        if action == 'reset':
            if database.update_avatar_url(username, None):
                _delete_local_avatar_file(old_avatar)
                return jsonify({
                    'message': '头像已恢复默认',
                    'redirect': url_for('chat')
                })
            return jsonify({'error': '头像更新失败'}), 500

        avatar_file = request.files.get('avatar')
        avatar_path, error = _save_avatar_image(username, avatar_file)
        if error:
            return jsonify({'error': error}), 400

        if database.update_avatar_url(username, avatar_path):
            _delete_local_avatar_file(old_avatar)
            return jsonify({
                'message': '头像设置成功',
                'redirect': url_for('chat')
            })

        _delete_local_avatar_file(avatar_path)
        return jsonify({'error': '头像更新失败'}), 500

    return render_template(
        'avatar_settings.html',
        site_name=app.config['SITE_NAME'],
        user_name=username,
        avatar_url=_normalize_avatar_path(database.get_avatar_url(username)),
        default_avatar_path=DEFAULT_AVATAR_PATH
    )

@app.route('/register', methods=['GET', 'POST'])
@no_login_only
def register():
    if request.method == 'POST':
        username = request.form['username']
        
        # 验证用户名长度
        if len(username) < 3 or len(username) > 20:
            return jsonify({'error': '用户名长度必须在3-20个字符之间'}), 400
        
        if not username.isalnum():
            return jsonify({'error': '用户名只能包含英文字母和数字'}), 400

        if database.user_exists(username):
            return jsonify({'error': '用户名已存在'}), 400

        if config.get("email_verification") == True:
            email=request.form['email']
            if database.email_used(email):
                return jsonify({'error': '邮箱已被使用'}), 400
            
            random_password = ''.join([random.choice('abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*(-_=+)') for i in range(24)])
            return_code = verification.send_verification_email(email, random_password)
            if return_code == -1:
                return jsonify({'error': '邮箱域名不可用'}), 400
            if return_code == -2:
                return jsonify({'error': '发送邮件失败'}), 400

            # 尝试添加用户
            if database.add_user(username, random_password):
                database.update_email(username, email)
                return jsonify({
                    'message': '注册成功，请查看邮件',
                    'redirect': url_for('login')
                })
            else:
                return jsonify({'error': '未知错误'}), 400

        else:
            password = request.form['password']
            
            # 验证密码长度
            if len(password) < 6:
                return jsonify({'error': '密码长度必须大于6个字符'}), 400
                
            # 尝试添加用户
            if database.add_user(username, password):
                return jsonify({
                    'message': '注册成功',
                    'redirect': url_for('login')
                })
            else:
                return jsonify({'error': '用户名已存在'}), 400

    if config.get("email_verification") == True:
        return render_template('register_email.html', site_name=app.config['SITE_NAME'], user_name=session.get('username'))
    
    else:
        return render_template('register.html', site_name=app.config['SITE_NAME'], user_name=session.get('username'))

@app.route('/login', methods=['GET', 'POST'])
@no_login_only
def login():
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        username = data.get('username')
        password = data.get('password')
        remember = data.get('remember', False)

        if not username or not password:
            return jsonify({'error': '用户名和密码不能为空'}), 400
        
        user = database.verify_user(username, password)

        if user:
            if remember:
                session.permanent = True
                app.permanent_session_lifetime = datetime.timedelta(days=30)
            else:
                session.permanent = False
            
            # 生成 token
            token = jwt.encode({
                'user_id': user['id'],
                'username': username,
                'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
            }, app.config['SECRET_KEY'])

            # 存储token到session
            session['token'] = token
            session['username'] = username

            database.add_session(
                username,
                token,
                user_agent=request.headers.get('User-Agent', ''),
                ip_address=request.headers.get('X-Forwarded-For', request.remote_addr or '')
            )

            return jsonify({
                'token': token,
                'message': '登录成功',
                'redirect': url_for('chat')
            })
        else:
            return jsonify({
                'error': '用户名或密码错误'
            }), 401

    return render_template('login.html', site_name=app.config['SITE_NAME'], user_name=session.get('username'))

@app.route('/logout')
@login_required
def logout():
    token = session.get('token')
    username = session.get('username')
    if token and username:
        database.remove_session(username, token)
    session.clear()
    return redirect(url_for('login'))

@app.route('/change-password', methods=['GET', 'POST'])
@login_required
def change_password():
    if request.method == 'POST':
        old_password = request.form['old_password']
        new_password = request.form['new_password']
        
        if len(new_password) < 6:
            return jsonify({'error': '密码长度必须大于6个字符'}), 400
        
        # 验证旧密码
        user = database.verify_user(session['username'], old_password)
        if user:
            # 更新密码
            database.update_password(session['username'], new_password)
            # 下线用户
            kick_user(session['username'])
            # 清除session
            session.clear()
            return jsonify({
                'message': '修改成功',
                'redirect': url_for('login')
            })
        else:
            return jsonify({'error': '旧密码错误'}), 401
    
    return render_template('change_password.html', site_name=app.config['SITE_NAME'], user_name=session.get('username'))

# 处理客户端连接
@socketio.on('connect')
def handle_connect():
    """处理websocket连接"""
    token = session.get('token')
    username = session.get('username')

    if not token or not username:
        return False
    
    if not database.verify_session(username, token):
        ws_connections[token] = request.sid
        Timer(2.0, close_ws_connection, args=[username, token]).start()
        return True

    database.update_session_seen(username, token)
    
    # 存储连接
    ws_connections[token] = request.sid

    # 获取历史消息
    messages = database.get_messages()
    for message in messages:
        emit('message', {
            'username': message['username'],
            'message': message['message'],
            'timestamp': message['timestamp'],
            'id': message['id'],
            'avatar_url': _normalize_avatar_path(message['avatar_url']),
            'edited_at': message['edited_at'],
            'is_admin': bool(message['is_admin'])
        })

    # 发送用户上线通知
    emit('user_online', {
        'message': '用户已连接',
        'username': username,
    }, broadcast=True)

    return True

@socketio.on('disconnect')
def handle_disconnect():
    """处理websocket断开连接"""
    token = session.get('token')
    username = session.get('username')

    if not token or not username:
        return False
    
    # 移除连接
    try:
        del ws_connections[token]
    except:
        pass

    # 发送用户离线通知
    emit('user_offline', {
        'message': '用户已断开连接',
        'forced': False,
        'username': username,
    }, broadcast=True)

    return True

def close_ws_connection(username, token):
    """关闭指定token的websocket连接"""
    with app.app_context():
        if token in ws_connections:
            sid = ws_connections[token]

            # 发送用户离线通知
            socketio.emit('user_offline', {
                'message': '用户会话已过期',
                'username': username,
            }, namespace='/', broadcast=True)

            # 发送强制下线通知
            socketio.emit('force_disconnect', {
                'message': '用户会话已过期'
            }, namespace='/', room=sid)
            
            # 等待前端处理通知（0.5秒）
            socketio.sleep(0.5)
            
            # 执行断开连接
            disconnect(sid, namespace='/')
            socketio.close_room(sid)
            try:
                del ws_connections[token]
            except:
                pass

# 处理新消息
@socketio.on('send_message')
def handle_message(data):
    if not session.get('username'):
        return
    
    if not session.get('token'):
        return
    
    # 阻止未授权的用户发送消息
    if not database.verify_session(session['username'], session['token']):
        return

    database.update_session_seen(session['username'], session['token'])
    
    username = session['username']
    payload = data if isinstance(data, dict) else {}
    message = _normalize_chat_message(payload.get('message'))
    
    if message:
        # 保存消息到数据库
        database.add_message(username, message)

        # 获取最新消息以确保时间格式一致
        last_message = database.get_last_message()
        if not last_message:
            return
        
        # 广播消息给所有连接的客户端
        emit('message', {
            'username': username,
            'message': last_message['message'],
            'timestamp': last_message['timestamp'],
            'id': last_message['id'],
            'avatar_url': _normalize_avatar_path(last_message['avatar_url']),
            'edited_at': last_message['edited_at'],
            'is_admin': bool(last_message['is_admin'])
        }, broadcast=True)


@socketio.on('edit_message')
def handle_edit_message(data):
    username = session.get('username')
    token = session.get('token')
    if not username or not token:
        return

    if not database.verify_session(username, token):
        return

    payload = data if isinstance(data, dict) else {}
    try:
        message_id = int(payload.get('id', 0))
    except (TypeError, ValueError):
        return

    new_message = _normalize_chat_message(payload.get('message'))
    if not message_id or not new_message:
        return

    original_message = database.get_message_by_id(message_id)
    if not original_message:
        return

    current_user_is_admin = database.is_admin(username)
    original_author_is_admin = bool(original_message['is_admin'])
    is_owner = original_message['username'] == username
    can_manage = is_owner or (current_user_is_admin and not original_author_is_admin)
    if not can_manage:
        return

    if not database.update_message(message_id, new_message):
        return

    updated_message = database.get_message_by_id(message_id)
    if not updated_message:
        return

    emit('message_updated', {
        'id': updated_message['id'],
        'message': updated_message['message'],
        'edited_at': updated_message['edited_at'],
    }, broadcast=True)


@socketio.on('delete_message')
def handle_delete_message(data):
    username = session.get('username')
    token = session.get('token')
    if not username or not token:
        return

    if not database.verify_session(username, token):
        return

    payload = data if isinstance(data, dict) else {}
    try:
        message_id = int(payload.get('id', 0))
    except (TypeError, ValueError):
        return

    if not message_id:
        return

    original_message = database.get_message_by_id(message_id)
    if not original_message:
        return

    current_user_is_admin = database.is_admin(username)
    original_author_is_admin = bool(original_message['is_admin'])
    is_owner = original_message['username'] == username
    can_manage = is_owner or (current_user_is_admin and not original_author_is_admin)
    if not can_manage:
        return

    if not database.delete_message(message_id):
        return

    emit('message_deleted', {
        'id': message_id,
    }, broadcast=True)

@socketio.on('check_messages')
def handle_check_messages(data):
    # 获取最新消息
    last_id = (data or {}).get('lastId', 0)
    try:
        last_id = int(last_id)
    except (TypeError, ValueError):
        last_id = 0
    messages = database.get_messages(last_id=last_id)
    # 发送新消息给客户端
    for message in messages:
        emit('message', {
            'id': message['id'],
            'username': message['username'],
            'message': message['message'],
            'timestamp': message['timestamp'],
            'avatar_url': _normalize_avatar_path(message['avatar_url']),
            'edited_at': message['edited_at'],
            'is_admin': bool(message['is_admin'])
        })

# 使用服务器配置
if __name__ == '__main__':
    server_config = config.get('server', {})
    if not isinstance(server_config, dict):
        server_config = {}

    socketio.run(app,
                debug=server_config.get('debug', True),
                host=server_config.get('host', '0.0.0.0'),
                port=server_config.get('port', 5000),
                use_reloader=False)