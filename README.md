# Circular Reference Detector

Traverses a JavaScript object graph and reports every edge that closes a reference cycle, with the exact path from the root to that edge.

```js
import { findCircularReferences } from './src/index.js';

const a = { name: 'a' };
const b = { name: 'b' };
a.b = b;
b.a = a;

const reports = findCircularReferences(a);
// [{ target: a, path: ['b', 'a'], depthOfAncestor: 0 }]
```

## Why this exists

Structuring data as a graph is convenient; serialising it (to JSON, for logs, for IPC) is where cycles bite. `JSON.stringify` throws `TypeError: Converting circular structure to JSON` and leaves you staring at a stack trace with no path. This library walks the graph once and tells you exactly which keys form each loop, so you can break the cycle deliberately before serialisation.

The trade-off: it reports one entry per back-edge, not per maximal strongly-connected component. A graph `a -> b -> a` and a graph `a -> b -> c -> a` both yield a single report describing the closing edge. If you want SCC decomposition, transform the output; the raw closing-edge data is the smallest faithful unit this library can return without imposing a grouping convention on you.

## Exports

- `findCircularReferences(root: unknown): CycleReport[]`

Where each `CycleReport` is `{ target: object, path: Array<string|number|symbol>, depthOfAncestor: number }`.

`path` is read from the root: `root[path[0]][path[1]]...[path[n-1]]` resolves to `target`. Array indices are reported as numbers; string keys and symbols are kept as-is. `depthOfAncestor` is the index within `path` of the ancestor node that `target` is identical to — `0` when the cycle closes back to the root.

## Edge you will hit

The detector traverses every own property, including symbols and non-enumerable ones reachable via `Reflect.ownKeys`. If you rely on properties being hidden from `Object.keys`, they are not hidden here. This is deliberate: a symbol-keyed property holding a back-reference is still a cycle that will break `JSON.stringify`. Getter properties that throw are skipped silently; a throwing getter is not itself a reference cycle and aborting the whole traversal for it would be worse.

Primitives are never memoised, because they cannot participate in an identity cycle. Wrapper objects (`new String`, `new Number`, etc.) are object-typed and are treated like any other object — a `box.self = box` cycle is real and is reported.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

