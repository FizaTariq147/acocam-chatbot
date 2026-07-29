import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTrackingNumber, looksLikeTrackingRef } from './tracking-ref.js';
import { safeEqual, sanitizeTenantId, sanitizeUserFacingError } from './security.js';
import { IntentEngine } from './intent.js';

describe('tracking-ref', () => {
  it('extracts ACO tracking numbers', () => {
    assert.equal(extractTrackingNumber('track ACO-123456 please'), 'ACO-123456');
  });

  it('ignores stopwords and plain words', () => {
    assert.equal(extractTrackingNumber('shipment services'), undefined);
    assert.equal(extractTrackingNumber('hello'), undefined);
  });

  it('validates tracking refs for workflow', () => {
    assert.equal(looksLikeTrackingRef('ACO-123456'), true);
    assert.equal(looksLikeTrackingRef('shipment'), false);
  });
});

describe('security', () => {
  it('sanitizes tenant ids', () => {
    assert.equal(sanitizeTenantId('acocam'), 'acocam');
    assert.equal(sanitizeTenantId('../etc'), null);
    assert.equal(sanitizeTenantId('ac/me'), null);
  });

  it('compares keys safely', () => {
    assert.equal(safeEqual('pk_demo', 'pk_demo'), true);
    assert.equal(safeEqual('pk_demo', 'pk_other'), false);
  });

  it('hides internal errors in production mode', () => {
    const msg = sanitizeUserFacingError('Cannot connect to logistics API at http://localhost:3019 (connection refused)', false);
    assert.ok(!msg.includes('localhost:3019'));
    assert.ok(!msg.includes('connection refused'));
  });
});

describe('intent', () => {
  const engine = new IntentEngine();
  const intents = [
    {
      code: 'shipment.track',
      label: 'Track',
      priority: 10,
      phrases: ['track shipment', 'track my shipment'],
      keywords: ['track', 'tracking'],
      handler: 'tool' as const,
      toolId: 'track_shipment',
    },
  ];

  it('routes action buttons directly', () => {
    const result = engine.detect('', intents, 'shipment.track');
    assert.equal(result.intent, 'shipment.track');
    assert.equal(result.confidence, 0.99);
  });

  it('detects track phrases', () => {
    const result = engine.detect('track my shipment', intents);
    assert.equal(result.intent, 'shipment.track');
    assert.ok(result.confidence > 0.5);
  });
});
