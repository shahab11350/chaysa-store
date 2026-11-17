const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bank = JSON.parse(fs.readFileSync(path.join(root, 'data/health/health-product-research.json'), 'utf8'));
const intake = JSON.parse(fs.readFileSync(path.join(root, 'data/health/product-evidence-intake.json'), 'utf8'));

test('research bank has expected top-level collections', () => {
  for (const key of ['products','botanicalProfiles','generalSafetyRules','sources','researchGaps','bookBibliography']) {
    assert.ok(Array.isArray(bank[key]), key + ' must be an array');
  }
  assert.equal(bank.status, 'research_draft_not_for_customer_answers');
});

test('all product records have a matching evidence-intake record', () => {
  assert.equal(intake.records.length, bank.products.length);
  for (const [i, product] of bank.products.entries()) {
    const record = intake.records[i];
    assert.equal(record.productName, product.name);
    assert.equal(record.sku ?? null, product.sku ?? null);
    for (const key of ['label','ingredients','netContent','preparation','storageBatch','manufacturerLicense','allergens']) {
      assert.ok(record.evidence[key], product.name + ': missing ' + key + ' intake slot');
    }
  }
});

test('source IDs are unique and source URLs are valid HTTPS URLs', () => {
  const ids = bank.sources.map(source => source.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate source IDs');
  for (const source of bank.sources) {
    assert.ok(source.id && source.title && source.publisher, 'incomplete source metadata');
    assert.equal(new URL(source.url).protocol, 'https:');
  }
});

test('product-specific health claims remain empty until evidence review', () => {
  for (const product of bank.products) {
    assert.equal(product.compositionStatus, 'unverified', product.name + ' composition must remain unverified');
    assert.deepEqual(product.productSpecificClaims, [], product.name + ' must not carry unverified claims');
  }
});

test('missing or duplicate SKU/name records are explicitly flagged, not silently merged', () => {
  const flagged = intake.records.filter(record => record.flags.length);
  assert.ok(flagged.some(record => record.flags.includes('missing_sku')));
  assert.ok(flagged.some(record => record.flags.includes('duplicate_name_requires_catalog_match')));
});
