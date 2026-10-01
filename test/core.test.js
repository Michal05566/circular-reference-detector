import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCircularReferences } from '../src/index.js';

/**
 * Helper: collect just the paths from a report list, for concise assertions.
 * @param {ReturnType<typeof findCircularReferences>} reports
 * @returns {Array<Array<string|number>>}
 */
function paths(reports) {
  return reports.map((r) => r.path);
}

test('returns an empty array for a primitive', () => {
  assert.deepEqual(findCircularReferences(42), []);
  assert.deepEqual(findCircularReferences('hi'), []);
  assert.deepEqual(findCircularReferences(null), []);
  assert.deepEqual(findCircularReferences(undefined), []);
  assert.deepEqual(findCircularReferences(true), []);
});

test('returns an empty array for a finite, acyclic object graph', () => {
  const obj = { a: 1, b: { c: 2, d: [3, 4, { e: 5 }] } };
  assert.deepEqual(findCircularReferences(obj), []);
});

test('detects a self-referencing object at the root', () => {
  const a = { name: 'a' };
  a.self = a;
  const reports = findCircularReferences(a);
  assert.equal(reports.length, 1);
  assert.strictEqual(reports[0].target, a);
  assert.deepEqual(reports[0].path, ['self']);
});

test('detects a two-node cycle and reports the closing edge', () => {
  const a = { name: 'a' };
  const b = { name: 'b' };
  a.b = b;
  b.a = a;
  const reports = findCircularReferences(a);
  assert.equal(reports.length, 1);
  assert.strictEqual(reports[0].target, a);
  assert.deepEqual(reports[0].path, ['b', 'a']);
});

test('detects a cycle whose closing edge is an array index', () => {
  const arr = [1, 2, 3];
  arr.push(arr); // arr[3] === arr
  const reports = findCircularReferences(arr);
  assert.equal(reports.length, 1);
  assert.strictEqual(reports[0].target, arr);
  assert.deepEqual(reports[0].path, [3]);
});

test('does not report a shared leaf as a cycle', () => {
  // Two parents reference the same object, but there is no path from the
  // leaf back to the root, so it is not a cycle.
  const leaf = { value: 0 };
  const root = { left: leaf, right: leaf };
  assert.deepEqual(findCircularReferences(root), []);
});

test('reports one cycle per back-edge when a node has multiple parents in a chain', () => {
  const root = { name: 'root' };
  const a = { name: 'a' };
  root.child = a;
  a.parent = root;            // back-edge to root
  a.self = a;                  // back-edge to a
  const reports = findCircularReferences(root);
  // Two distinct back-edges: a.parent -> root, a.self -> a.
  assert.equal(reports.length, 2);
  const byTarget = new Map(reports.map((r) => [r.target, r.path]));
  assert.deepEqual(byTarget.get(root), ['child', 'parent']);
  assert.deepEqual(byTarget.get(a), ['child', 'self']);
});

test('does not revisit a fully-explored subtree via a second path', () => {
  // `diamond` points to `shared`, and `shared.loop = shared` is a cycle.
  // `shared` is reachable via both root.diamond and root.diamond2, but the
  // cycle should be reported exactly once because after the first visit
  // `shared` is in `fullyVisited`.
  const shared = { name: 'shared' };
  shared.loop = shared;
  const root = { diamond: shared, diamond2: shared };
  const reports = findCircularReferences(root);
  assert.equal(reports.length, 1);
  assert.strictEqual(reports[0].target, shared);
  assert.deepEqual(reports[0].path, ['diamond', 'loop']);
});

test('detects a cycle through a symbol-keyed property', () => {
  const sym = Symbol('back');
  const node = { name: 'n' };
  node[sym] = node;
  const reports = findCircularReferences(node);
  assert.equal(reports.length, 1);
  assert.strictEqual(reports[0].target, node);
  assert.equal(reports[0].path.length, 1);
  assert.strictEqual(reports[0].path[0], sym);
});

test('skips accessor properties that throw without aborting traversal', () => {
  const obj = {};
  Object.defineProperty(obj, 'boom', {
    enumerable: true,
    get() { throw new Error('nope'); },
  });
  obj.after = { ok: true };
  // Should not throw, and should still traverse `after`.
  const reports = findCircularReferences(obj);
  assert.deepEqual(reports, []);
});

test('handles a wrapper object cycle (new String)', () => {
  const box = new String('x'); // object-typed
  box.self = box;
  const reports = findCircularReferences(box);
  assert.equal(reports.length, 1);
  assert.strictEqual(reports[0].target, box);
  assert.deepEqual(reports[0].path, ['self']);
});

test('depthOfAncestor points at the correct stack entry for a deeper cycle', () => {
  const root = { name: 'root' };
  const a = { name: 'a' };
  const b = { name: 'b' };
  const c = { name: 'c' };
  root.a = a;
  a.b = b;
  b.c = c;
  c.back = root; // closes the cycle back to the root, depth 0
  const reports = findCircularReferences(root);
  assert.equal(reports.length, 1);
  assert.strictEqual(reports[0].target, root);
  assert.deepEqual(reports[0].path, ['a', 'b', 'c', 'back']);
  assert.equal(reports[0].depthOfAncestor, 0);
});
