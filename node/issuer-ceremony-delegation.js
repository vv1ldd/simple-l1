'use strict';

const normalizedHost = (host) => String(host || '').split(':')[0].toLowerCase();

const parseIssuerCeremonyMap = (raw = '') => String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((map, item) => {
        const [issuer, ceremony] = item.split('=').map((part) => String(part || '').trim().toLowerCase());
        if (issuer && ceremony) map[issuer] = ceremony;
        return map;
    }, {});

const ceremonyHostForIssuer = (issuerHost, map) => {
    const hostname = normalizedHost(issuerHost);
    const ceremonyHost = map[hostname];
    if (!ceremonyHost || ceremonyHost === hostname) {
        return null;
    }

    return ceremonyHost;
};

module.exports = {
    normalizedHost,
    parseIssuerCeremonyMap,
    ceremonyHostForIssuer,
};
