'use strict';

const assert = require('assert');
const {
    parseIssuerCeremonyMap,
    ceremonyHostForIssuer,
} = require('../issuer-ceremony-delegation');

const map = parseIssuerCeremonyMap('pass.meanly.one=connect.identity.meanly.one,pass.bank-x.com=connect.identity.bank-x.com');
assert.deepStrictEqual(map, {
    'pass.meanly.one': 'connect.identity.meanly.one',
    'pass.bank-x.com': 'connect.identity.bank-x.com',
});

assert.strictEqual(
    ceremonyHostForIssuer('pass.meanly.one', map),
    'connect.identity.meanly.one',
);
assert.strictEqual(
    ceremonyHostForIssuer('connect.identity.meanly.one', map),
    null,
);
assert.strictEqual(
    ceremonyHostForIssuer('pass.simplelayer.one', map),
    null,
);

const empty = parseIssuerCeremonyMap('');
assert.deepStrictEqual(empty, {});

console.log('PASS issuer ceremony delegation map');
