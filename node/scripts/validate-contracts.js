#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const repoRoot = path.resolve(__dirname, '..', '..');
const contractsDir = path.join(repoRoot, 'docs', 'contracts');
const examplesDir = path.join(repoRoot, 'docs', 'examples');

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
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(dir, name));
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

for (const filePath of [...jsonFiles(contractsDir), ...jsonFiles(examplesDir)]) {
  validateJsonParse(filePath);
}

const joinRequestSchemaPath = path.join(contractsDir, 'join-request.schema.json');
const namespaceArtifactSchemaPath = path.join(contractsDir, 'namespace-artifact.schema.json');
const joinRequestSchema = compileSchema(joinRequestSchemaPath);
const namespaceArtifactSchema = compileSchema(namespaceArtifactSchemaPath);

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

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} contract validation check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} contract validation check(s) passed.`);
