'use strict';

const crypto = require('crypto');
const { canonicalJson } = require('./canonical-json');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function sha256Tagged(input) {
  return `sha256:${sha256Hex(input)}`;
}

function objectHash(value) {
  return sha256Tagged(canonicalJson(value));
}

function domainHash(domain, fields) {
  return sha256Tagged(canonicalJson({
    domain,
    fields,
  }));
}

module.exports = {
  domainHash,
  objectHash,
  sha256Hex,
  sha256Tagged,
};
