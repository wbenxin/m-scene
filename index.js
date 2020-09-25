const fs = require('fs').promises;
const path = require('path');

const Wechat = require('./lib/wechat');
const Wework = require('./lib/wework');

const token_dir = path.join(__dirname, '.cache/access_tokens');
fs.mkdir(token_dir, { recursive: true });
// 每分钟检查一次, 超过2小时未更新的直接删掉
setInterval(async () => {
  try {
    let files = await fs.readdir(token_dir);
    files.forEach(async file => {
      let stats = await fs.stat(path.join(token_dir, file));
      if (Date.now() - stats.mtimeMs > 7200 * 1000) {
        await fs.unlink(path.join(token_dir, file));
      }
    });
  } catch (e) {
    console.error(e);
  }
}, 60 * 1000);

exports.Wechat = Wechat;
exports.Wework = Wework;
