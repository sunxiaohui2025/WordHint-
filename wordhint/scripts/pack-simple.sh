#!/bin/bash
# WordHint Chrome 扩展简单打包脚本（使用系统 Chrome）

EXT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_PATH="$(dirname "$EXT_PATH")"
BUILD_PATH="$ROOT_PATH/build"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Chrome 会在父目录生成 .crx 和 .pem 文件
TEMP_CRX="$ROOT_PATH/wordhint.crx"
TEMP_PEM="$ROOT_PATH/wordhint.pem"

# 检查 Chrome 是否存在
if [ ! -f "$CHROME" ]; then
    echo "❌ 未找到 Chrome，请修改 CHROME 变量路径"
    echo "   或使用浏览器手动打包"
    exit 1
fi

# 创建 build 目录
mkdir -p "$BUILD_PATH"

# 清理旧的临时文件
rm -f "$TEMP_CRX" "$TEMP_PEM"

echo "📦 开始打包..."
echo "   扩展路径：$EXT_PATH"
echo "   Chrome: $CHROME"

# 调用 Chrome 打包（会在父目录生成文件）
"$CHROME" --pack-extension="$EXT_PATH" --disable-gpu

# 检查是否生成成功
if [ -f "$TEMP_CRX" ]; then
    mv "$TEMP_CRX" "$BUILD_PATH/wordhint.crx"
    echo "   ✅ CRX: $BUILD_PATH/wordhint.crx"
else
    echo "❌ CRX 文件生成失败"
    exit 1
fi

if [ -f "$TEMP_PEM" ]; then
    mv "$TEMP_PEM" "$BUILD_PATH/wordhint.pem"
    echo "   🔑 PEM: $BUILD_PATH/wordhint.pem"
    echo "      ⚠️ 请妥善保管！丢失后无法更新同一扩展"
fi

echo ""
echo "✅ 打包完成!"
echo "   安装方式：将 .crx 文件拖拽到 chrome://extensions/ 页面"
