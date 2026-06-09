function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value), null, 2);
}

module.exports = {
  canonicalize,
  stableJson,
};
