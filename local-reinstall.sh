#!/bin/bash
# local-reinstall.sh - 本地重装 openclaw-easemob 插件
# 用法: ./local-reinstall.sh [插件路径]

set -e

PLUGIN_ID="openclaw-easemob"
PLUGIN_PATH="${1:-./}"
CONFIG_FILE="${HOME}/.openclaw/openclaw.json"
BACKUP_DIR="${HOME}/.openclaw/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 1. 备份配置
if [ -f "$CONFIG_FILE" ]; then
    mkdir -p "$BACKUP_DIR"
    cp "$CONFIG_FILE" "$BACKUP_DIR/openclaw.json.bak.${TIMESTAMP}"
    log_info "配置已备份"
else
    log_warn "配置文件不存在"
fi

# 2. 提取当前 channels.easemob 配置
CHANNEL_CONFIG=""
if [ -f "$CONFIG_FILE" ]; then
    # 使用 Python 提取（更可靠）
    CHANNEL_CONFIG=$(python3 -c "
import json
import sys
try:
    with open('$CONFIG_FILE', 'r') as f:
        cfg = json.load(f)
        if 'channels' in cfg and 'easemob' in cfg['channels']:
            print(json.dumps(cfg['channels']['easemob']))
except:
    pass
" 2>/dev/null || true)
fi

# 3. 卸载旧插件
log_info "卸载旧版本..."
openclaw plugins uninstall "$PLUGIN_ID" --keep-files --force 2>/dev/null || true

# 4. 清理残留目录
EXTENSIONS_DIR="${HOME}/.openclaw/extensions"
if [ -d "${EXTENSIONS_DIR}/${PLUGIN_ID}" ]; then
    rm -rf "${EXTENSIONS_DIR}/${PLUGIN_ID}"
    log_info "清理残留目录"
fi

# 5. 临时移除 channels.easemob 配置
if [ -f "$CONFIG_FILE" ] && [ -n "$CHANNEL_CONFIG" ]; then
    python3 -c "
import json
with open('$CONFIG_FILE', 'r') as f:
    cfg = json.load(f)
if 'channels' in cfg and 'easemob' in cfg['channels']:
    del cfg['channels']['easemob']
    if not cfg['channels']:
        del cfg['channels']
with open('$CONFIG_FILE', 'w') as f:
    json.dump(cfg, f, indent=2)
" 2>/dev/null || true
    log_info "临时移除 channels.easemob"
fi

# 6. 安装新版本
log_info "安装新版本 from ${PLUGIN_PATH}..."
if ! openclaw plugins install "$PLUGIN_PATH"; then
    log_error "安装失败"
    exit 1
fi
log_info "安装成功"

# 7. 恢复 channels.easemob 配置
if [ -n "$CHANNEL_CONFIG" ]; then
    python3 -c "
import json
with open('$CONFIG_FILE', 'r') as f:
    cfg = json.load(f)
if 'channels' not in cfg:
    cfg['channels'] = {}
cfg['channels']['easemob'] = json.loads('$CHANNEL_CONFIG')
with open('$CONFIG_FILE', 'w') as f:
    json.dump(cfg, f, indent=2)
"
    log_info "已恢复 channels.easemob 配置"
fi

log_info "完成！"
