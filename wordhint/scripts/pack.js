/**
 * WordHint Chrome 扩展打包脚本
 * 生成 .crx 文件（需要 Chrome/Chromium）
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXT_PATH = path.resolve(__dirname, '..');
const BUILD_PATH = path.resolve(EXT_PATH, '..', 'build');
const KEY_FILE = path.join(BUILD_PATH, 'wordhint.pem');

// 确保 build 目录存在
if (!fs.existsSync(BUILD_PATH)) {
  fs.mkdirSync(BUILD_PATH, { recursive: true });
  console.log(`✅ 创建构建目录：${BUILD_PATH}`);
}

// 查找 Chrome/Chromium 可执行文件
function findChrome() {
  const candidates = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    process.env.CHROME_BIN,
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

const chrome = findChrome();

if (!chrome) {
  console.log('⚠️  未找到 Chrome/Chromium，使用 ZIP 打包方式\n');
  packZip();
  process.exit(0);
}

console.log(`📦 使用 Chrome 打包：${chrome}\n`);

try {
  // 使用 Chrome 命令行打包
  const args = [
    '--pack-extension=' + EXT_PATH,
    '--pack-extension-key=' + KEY_FILE,
    '--disable-gpu'
  ];
  
  console.log('正在打包...');
  execSync(`"${chrome}" ${args.join(' ')}`, { stdio: 'inherit' });
  
  const crxFile = path.join(EXT_PATH, 'wordhint.crx');
  if (fs.existsSync(crxFile)) {
    // 移动到 build 目录
    const destCrx = path.join(BUILD_PATH, 'wordhint.crx');
    fs.renameSync(crxFile, destCrx);
    console.log(`\n✅ 打包完成：${destCrx}`);
    console.log(`📁 私钥文件：${KEY_FILE}（请妥善保管！）`);
  }
} catch (e) {
  console.error('❌ 打包失败:', e.message);
  console.log('\n尝试使用 ZIP 方式打包...\n');
  packZip();
}

function packZip() {
  const archiver = require('archiver');
  const zipFile = path.join(BUILD_PATH, 'wordhint.zip');
  const output = fs.createWriteStream(zipFile);
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  output.on('close', () => {
    console.log(`✅ ZIP 打包完成：${zipFile}`);
    console.log(`📊 文件大小：${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
  });
  
  archive.on('error', (err) => {
    console.error('❌ ZIP 打包失败:', err);
    process.exit(1);
  });
  
  archive.pipe(output);
  
  // 添加扩展文件（排除不需要打包的文件）
  const exclude = ['node_modules', '.DS_Store', 'test', 'scripts', 'package.json'];
  
  fs.readdirSync(EXT_PATH).forEach(file => {
    if (!exclude.includes(file)) {
      const filePath = path.join(EXT_PATH, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        archive.file(filePath, { name: file });
      } else if (stat.isDirectory()) {
        archive.directory(filePath, file);
      }
    }
  });
  
  archive.finalize();
}
