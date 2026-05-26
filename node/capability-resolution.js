const {
    assertEntityAddress,
    assertKeyAddress,
    normalizeKeyAddress,
} = require('./identity-kernel');

const POLICY_PRECEDENCE = [
    ['deny', 'deny'],
    ['require_quorum', 'quorum'],
    ['require_approval', 'approval'],
    ['allow', 'allow'],
];

function normalizeGrant(grant) {
    return {
        ...grant,
        entity_l1_address: String(grant.entity_l1_address || '').toLowerCase(),
        key_l1_address: grant.key_l1_address ? String(grant.key_l1_address).toLowerCase() : null,
        capability: String(grant.capability || ''),
        scope: String(grant.scope || ''),
        policy: String(grant.policy || 'deny').toLowerCase(),
        status: String(grant.status || 'active').toLowerCase(),
    };
}

function isActiveGrant(grant, now = new Date()) {
    if (grant.status !== 'active') return false;
    if (!grant.expires_at) return true;

    return new Date(grant.expires_at).getTime() > now.getTime();
}

function decideCapability(grants, input, now = new Date()) {
    const entityAddress = assertEntityAddress(input.entity_l1_address);
    const proofKeyAddress = input.proof_key_l1_address
        ? assertKeyAddress(input.proof_key_l1_address)
        : null;
    const capability = String(input.capability || '');
    const scope = String(input.scope || '');

    if (!capability || !scope) {
        throw new Error('capability and scope are required');
    }

    if (capability.includes('*') || scope.includes('*')) {
        throw new Error('wildcard capability or scope resolution is not part of CRE v1');
    }

    const matchedGrants = (grants || [])
        .map(normalizeGrant)
        .filter((grant) => isActiveGrant(grant, now))
        .filter((grant) => grant.entity_l1_address === entityAddress)
        .filter((grant) => grant.capability === capability)
        .filter((grant) => grant.scope === scope)
        .filter((grant) => {
            const grantKeyAddress = normalizeKeyAddress(grant.key_l1_address);

            return !grantKeyAddress || grantKeyAddress === proofKeyAddress;
        });

    if (matchedGrants.length === 0) {
        return {
            decision: 'deny',
            matched_grants: [],
            reason_codes: ['NO_MATCHING_GRANT'],
            confidence: 1,
        };
    }

    for (const [policy, decision] of POLICY_PRECEDENCE) {
        const policyGrants = matchedGrants.filter((grant) => grant.policy === policy);

        if (policyGrants.length > 0) {
            return {
                decision,
                matched_grants: policyGrants.map((grant) => grant.id).filter(Boolean),
                reason_codes: [`MATCHED_${policy.toUpperCase()}_GRANT`],
                confidence: 1,
            };
        }
    }

    return {
        decision: 'deny',
        matched_grants: matchedGrants.map((grant) => grant.id).filter(Boolean),
        reason_codes: ['NO_SUPPORTED_POLICY'],
        confidence: 1,
    };
}

module.exports = {
    decideCapability,
};
