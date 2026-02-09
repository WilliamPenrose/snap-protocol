import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, '..', '..', 'schemas');
const testsDir = join(schemasDir, 'tests');

// Load common schema (needed for $ref resolution)
const commonSchema = JSON.parse(readFileSync(join(schemasDir, 'common.schema.json'), 'utf-8'));

// Initialize Ajv with JSON Schema 2020-12 support
const ajv = new Ajv2020({
  strict: false,
  allErrors: true
});
addFormats(ajv);

// Add common schema for $ref resolution
ajv.addSchema(commonSchema);

// Find and run all test files
const testFiles = readdirSync(testsDir).filter(f => f.endsWith('.test.json'));

let totalTests = 0;
let passed = 0;
let failed = 0;
const failures = [];

for (const testFile of testFiles) {
  const testData = JSON.parse(readFileSync(join(testsDir, testFile), 'utf-8'));
  const schemaPath = join(testsDir, testData.schema);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

  console.log(`\n--- ${testData.description} ---`);
  console.log(`Schema: ${testData.schema}`);

  const validate = ajv.compile(schema);

  for (const test of testData.tests) {
    totalTests++;
    const valid = validate(test.data);

    if (valid === test.valid) {
      passed++;
      console.log(`  PASS: ${test.description}`);
    } else {
      failed++;
      const detail = valid
        ? 'Expected INVALID but schema accepted it'
        : `Expected VALID but got errors: ${JSON.stringify(validate.errors, null, 2)}`;
      failures.push({ file: testFile, test: test.description, detail });
      console.log(`  FAIL: ${test.description}`);
      console.log(`        ${detail}`);
    }
  }
}

// Summary
console.log('\n========================================');
console.log(`Total: ${totalTests}  Passed: ${passed}  Failed: ${failed}`);
console.log('========================================');

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  [${f.file}] ${f.test}`);
    console.log(`    ${f.detail}`);
  }
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
}
