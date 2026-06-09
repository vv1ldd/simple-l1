const crypto = require('crypto');

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

module.exports = {
  sha256,
};
