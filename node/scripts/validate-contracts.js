#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const repoRoot = path.resolve(__dirname, '..', '..');
const contractsDir = path.join(repoRoot, 'docs', 'contracts');
const examplesDir = path.join(repoRoot, 'docs', 'examples');
const specsDir = path.join(repoRoot, 'docs', 'specs');
const testVectorsDir = path.join(repoRoot, 'test-vectors');

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
addFormats(ajv);

const checks = [];

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function recordPass(label) {
  checks.push({ ok: true, label });
  console.log(`PASS ${label}`);
}

function recordFail(label, error) {
  checks.push({ ok: false, label, error });
  console.error(`FAIL ${label}`);
  if (error) {
    console.error(String(error).split('\n').map((line) => `  ${line}`).join('\n'));
  }
}

function jsonFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return jsonFiles(entryPath);
      if (entry.name.endsWith('.json')) return [entryPath];
      return [];
    })
    .sort();
}

function validateJsonParse(filePath) {
  try {
    readJson(filePath);
    recordPass(`${relative(filePath)} parses as JSON`);
  } catch (error) {
    recordFail(`${relative(filePath)} parses as JSON`, error.message);
  }
}

function compileSchema(filePath) {
  try {
    const schema = readJson(filePath);
    const validate = ajv.compile(schema);
    recordPass(`${relative(filePath)} compiles as JSON Schema`);
    return validate;
  } catch (error) {
    recordFail(`${relative(filePath)} compiles as JSON Schema`, error.message);
    return null;
  }
}

function formatErrors(validate) {
  return ajv.errorsText(validate.errors, { separator: '\n' });
}

function validateExample(examplePath, validate, schemaName) {
  if (!validate) {
    recordFail(`${relative(examplePath)} conforms to ${schemaName}`, 'schema did not compile');
    return;
  }

  try {
    const example = readJson(examplePath);
    if (validate(example)) {
      recordPass(`${relative(examplePath)} conforms to ${schemaName}`);
    } else {
      recordFail(`${relative(examplePath)} conforms to ${schemaName}`, formatErrors(validate));
    }
  } catch (error) {
    recordFail(`${relative(examplePath)} conforms to ${schemaName}`, error.message);
  }
}

const layerBVerdicts = new Set([
  'candidate',
  'challenged',
  'finalized',
  'invalidated',
  'rejected',
]);

const layerCStatuses = new Set([
  'MATCHED',
  'NOT_MATCHED',
  'AMBIGUOUS',
  'NOT_ELIGIBLE',
]);

const forbiddenOwnershipPatterns = [
  /(^|[_\-\s])asset[_\-\s]?owner($|[_\-\s])/i,
  /(^|[_\-\s])owner(ship)?($|[_\-\s])/i,
  /(^|[_\-\s])balance(s)?($|[_\-\s])/i,
  /(^|[_\-\s])custody($|[_\-\s])/i,
  /(^|[_\-\s])custodial($|[_\-\s])/i,
  /(^|[_\-\s])account[_\-\s]?state($|[_\-\s])/i,
  /(^|[_\-\s])protocol[_\-\s]?state($|[_\-\s])/i,
  /(^|[_\-\s])transferred[_\-\s]?to[_\-\s]?user($|[_\-\s])/i,
  /(^|[_\-\s])user[_\-\s]?received([_\-\s]?funds)?($|[_\-\s])/i,
  /(^|[_\-\s])received[_\-\s]?funds($|[_\-\s])/i,
  /(^|[_\-\s])credited($|[_\-\s])/i,
  /(^|[_\-\s])debited($|[_\-\s])/i,
  /(^|[_\-\s])owns($|[_\-\s])/i,
];

const ownershipSentinelKeys = new Set([
  'ownership_verdict',
  'state_mutation',
]);

const proseKeys = new Set([
  'description',
  'rule',
]);

const metadataStringKeys = new Set([
  'context_id',
  'fixture_id',
  'id',
  'intent_id',
  'observed_at',
  'schema_version',
  'source',
]);

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function jsonPath(parts) {
  return parts.length ? parts.join('.') : '$';
}

function hasForbiddenOwnershipSemantics(value) {
  return forbiddenOwnershipPatterns.some((pattern) => pattern.test(value));
}

function layerFixtureFiles() {
  return fs.readdirSync(testVectorsDir)
    .filter((name) => (
      name.startsWith('evm-') ||
      name.startsWith('fpl-v0-') ||
      name.startsWith('reconciliation-v0-')
    ))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(testVectorsDir, name));
}

function validateOwnershipFirewall(filePath) {
  const errors = [];
  let document;
  try {
    document = readJson(filePath);
  } catch (error) {
    recordFail(`${relative(filePath)} preserves ownership semantics firewall`, error.message);
    return;
  }

  function visit(value, parts, parent = null, key = null) {
    if (ownershipSentinelKeys.has(key)) {
      if (value !== null) {
        errors.push(`${jsonPath(parts)} must remain null before Layer D exists`);
      }
      return;
    }

    if (typeof key === 'string' && hasForbiddenOwnershipSemantics(key)) {
      errors.push(`${jsonPath(parts)} has ownership-like field name "${key}"`);
    }

    if (typeof value === 'string') {
      if (
        key !== null &&
        !proseKeys.has(key) &&
        !metadataStringKeys.has(key) &&
        hasForbiddenOwnershipSemantics(value)
      ) {
        errors.push(`${jsonPath(parts)} has ownership-like string "${value}"`);
      }

      if (key === 'verdict' && !layerBVerdicts.has(value)) {
        errors.push(`${jsonPath(parts)} introduces non-frozen Layer B verdict "${value}"`);
      }

      if (key === 'status' && parent?.object_type === 'ReconciliationResult' && !layerCStatuses.has(value)) {
        errors.push(`${jsonPath(parts)} introduces non-frozen Layer C status "${value}"`);
      }
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...parts, String(index)], value, String(index)));
      return;
    }

    if (isPlainObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, [...parts, childKey], value, childKey);
      }
    }
  }

  visit(document, []);

  if (errors.length === 0) {
    recordPass(`${relative(filePath)} preserves ownership semantics firewall`);
  } else {
    recordFail(`${relative(filePath)} preserves ownership semantics firewall`, errors.join('\n'));
  }
}

for (const filePath of [...jsonFiles(contractsDir), ...jsonFiles(examplesDir), ...jsonFiles(specsDir)]) {
  validateJsonParse(filePath);
}

for (const filePath of layerFixtureFiles()) {
  validateOwnershipFirewall(filePath);
}

const joinRequestSchemaPath = path.join(contractsDir, 'join-request.schema.json');
const namespaceArtifactSchemaPath = path.join(contractsDir, 'namespace-artifact.schema.json');
const truthSpecSchemaPath = path.join(contractsDir, 'truth-spec.schema.json');
const executionResultEnvelopeSchemaPath = path.join(contractsDir, 'execution-result-envelope.schema.json');
const signedGuardArtifactSchemaPath = path.join(contractsDir, 'signed-guard-artifact.schema.json');
const signedDecisionGraphSchemaPath = path.join(contractsDir, 'signed-decision-graph.schema.json');
const shadowDivergenceRecordSchemaPath = path.join(contractsDir, 'shadow-divergence-record.schema.json');
const identityProofEnvelopeSchemaPath = path.join(contractsDir, 'identity-proof', 'schema', 'identity-proof-envelope.schema.json');
const identityStateEnvelopeSchemaPath = path.join(contractsDir, 'identity-mesh', 'schema', 'identity-state-envelope.schema.json');
const subjectAuthorityEventSchemaPath = path.join(contractsDir, 'subject-authority', 'schema', 'authority-event.schema.json');
const joinRequestSchema = compileSchema(joinRequestSchemaPath);
const namespaceArtifactSchema = compileSchema(namespaceArtifactSchemaPath);
const truthSpecSchema = compileSchema(truthSpecSchemaPath);
const executionResultEnvelopeSchema = compileSchema(executionResultEnvelopeSchemaPath);
const signedGuardArtifactSchema = compileSchema(signedGuardArtifactSchemaPath);
const signedDecisionGraphSchema = compileSchema(signedDecisionGraphSchemaPath);
const shadowDivergenceRecordSchema = compileSchema(shadowDivergenceRecordSchemaPath);
const identityProofEnvelopeSchema = compileSchema(identityProofEnvelopeSchemaPath);
const identityStateEnvelopeSchema = compileSchema(identityStateEnvelopeSchemaPath);
compileSchema(subjectAuthorityEventSchemaPath);

validateExample(
  path.join(examplesDir, 'join-request.example.json'),
  joinRequestSchema,
  'join-request.schema.json',
);

for (const name of [
  'dns-allocated.example.json',
  'issuer-reachable.example.json',
  'issuer-unreachable.example.json',
]) {
  validateExample(
    path.join(examplesDir, name),
    namespaceArtifactSchema,
    'namespace-artifact.schema.json',
  );
}

validateExample(
  path.join(specsDir, 'sl1-truth-spec.v1.json'),
  truthSpecSchema,
  'truth-spec.schema.json',
);

validateExample(
  path.join(examplesDir, 'signed-decision-graph.example.json'),
  signedDecisionGraphSchema,
  'signed-decision-graph.schema.json',
);

validateExample(
  path.join(examplesDir, 'execution-result-envelope.example.json'),
  executionResultEnvelopeSchema,
  'execution-result-envelope.schema.json',
);

validateExample(
  path.join(examplesDir, 'shadow-divergence-record.example.json'),
  shadowDivergenceRecordSchema,
  'shadow-divergence-record.schema.json',
);

try {
  execFileSync(process.execPath, [path.join(__dirname, 'test-subject-authority-runtime.js')], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  recordPass('SL1 subject authority runtime suite passes');
} catch (error) {
  recordFail('SL1 subject authority runtime suite passes', error.stderr || error.message);
}

try {
  execFileSync(process.execPath, [path.join(__dirname, 'test-identity-proof-runtime.js')], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  recordPass('SL1 identity proof runtime suite passes');
} catch (error) {
  recordFail('SL1 identity proof runtime suite passes', error.stderr || error.message);
}

try {
  execFileSync(process.execPath, [path.join(__dirname, 'test-identity-proof-conformance.js')], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  recordPass('SL1 identity proof conformance suite passes');
} catch (error) {
  recordFail('SL1 identity proof conformance suite passes', error.stderr || error.message);
}

try {
  execFileSync(process.execPath, [path.join(__dirname, 'test-identity-mesh-runtime.js')], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  recordPass('SL1 identity mesh runtime suite passes');
} catch (error) {
  recordFail('SL1 identity mesh runtime suite passes', error.stderr || error.message);
}

try {
  execFileSync(process.execPath, [path.join(__dirname, 'test-identity-mesh-conformance.js')], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  recordPass('SL1 identity mesh conformance suite passes');
} catch (error) {
  recordFail('SL1 identity mesh conformance suite passes', error.stderr || error.message);
}

try {
  execFileSync(process.execPath, [path.join(__dirname, 'compile-truth-spec.js'), '--check'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  recordPass('SL1 Truth Spec v1 compiles to derived enforcement artifacts');
} catch (error) {
  recordFail('SL1 Truth Spec v1 compiles to derived enforcement artifacts', error.stderr || error.message);
}

try {
  const output = execFileSync(process.execPath, [path.join(__dirname, 'compile-truth-spec.js'), '--decision-graph'], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  const decisionGraph = JSON.parse(output);
  if (signedDecisionGraphSchema && signedDecisionGraphSchema(decisionGraph)) {
    recordPass('SL1 signed decision graph artifact conforms to signed-decision-graph.schema.json');
  } else if (signedDecisionGraphSchema) {
    recordFail('SL1 signed decision graph artifact conforms to signed-decision-graph.schema.json', formatErrors(signedDecisionGraphSchema));
  }
} catch (error) {
  recordFail('SL1 signed decision graph artifact conforms to signed-decision-graph.schema.json', error.stderr || error.message);
}

try {
  const output = execFileSync(process.execPath, [path.join(__dirname, 'compile-truth-spec.js'), '--release-bundle'], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  const bundle = JSON.parse(output);
  if (signedGuardArtifactSchema && signedGuardArtifactSchema(bundle)) {
    recordPass('SL1 signed guard artifact release bundle conforms to signed-guard-artifact.schema.json');
  } else if (signedGuardArtifactSchema) {
    recordFail('SL1 signed guard artifact release bundle conforms to signed-guard-artifact.schema.json', formatErrors(signedGuardArtifactSchema));
  }
} catch (error) {
  recordFail('SL1 signed guard artifact release bundle conforms to signed-guard-artifact.schema.json', error.stderr || error.message);
}

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} contract validation check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} contract validation check(s) passed.`);
