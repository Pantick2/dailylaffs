const test = require('node:test');
const assert = require('node:assert/strict');
const { getTeaserClip } = require('../preview-utils');

test('teaser clip uses the upper half of the screenshot', () => {
  assert.deepEqual(getTeaserClip(800, 800), { x: 0, y: 0, width: 800, height: 400 });
  assert.deepEqual(getTeaserClip(600, 1000), { x: 0, y: 0, width: 600, height: 500 });
});
