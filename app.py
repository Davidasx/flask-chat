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
        return {'current_user_avatar': DEFAULT_AVATAR_PATH, 'default_avatar_path': DEFAULT_AVATAR_PATH}

    return {
        'current_user_avatar': _normalize_avatar_path(database.get_avatar_url(username)),
        'default_avatar_path': DEFAULT_AVATAR_PATH
    }

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = session.get('token')
        username = session.get('username')

        if not token or not username:
            return redirect(url_for('login'))
            
        if database.verify_session(username, token):
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
        default_avatar_path=DEFAULT_AVATAR_PATH
    )


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

            database.add_session(username, token)

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
            'avatar_url': _normalize_avatar_path(message['avatar_url'])
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
    
    username = session['username']
    message = data.get('message', '').strip()
    
    if message:
        # 保存消息到数据库
        database.add_message(username, message)

        # 获取最新消息以确保时间格式一致
        last_message = database.get_last_message()
        
        # 广播消息给所有连接的客户端
        emit('message', {
            'username': username,
            'message': message,
            'timestamp': last_message['timestamp'],
            'id': last_message['id'],
            'avatar_url': _normalize_avatar_path(last_message['avatar_url'])
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
            'avatar_url': _normalize_avatar_path(message['avatar_url'])
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