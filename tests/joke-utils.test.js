const test = require('node:test');
const assert = require('node:assert/strict');
const { isUniqueJoke } = require('../joke-utils');

test('detects duplicate jokes based on normalized content', () => {
  const existingMemes = [
    { title: 'Same Joke', body: 'I bought a planner to get organized.', closing: 'Now it is just a very expensive guilt diary.' }
  ];

  assert.equal(
    isUniqueJoke({ title: 'Same Joke', body: 'I bought a planner to get organized.', closing: 'Now it is just a very expensive guilt diary.' }, existingMemes),
    false
  );

  assert.equal(
    isUniqueJoke({ title: 'Different Joke', body: 'I downloaded a meditation app and immediately panicked.', closing: 'My inner peace is on a low battery.' }, existingMemes),
    true
  );
});
