/**
 * Sentinel value used as the root of a path. The JavaScript runtime ensures
 * that no object created by user code can be strictly equal to this symbol, so
 * it can never collide with a key that legitimately exists in a traversed
 * graph.
 */
const ROOT = Symbol('circular-root');

/**
 * A description of one place in an object graph where a cycle closes.
 *
 * @typedef {Object} CycleReport
 * @property {unknown} target  The object that was revisited.
 * @property {Array<string|number>} path The keys from the root down to the
 *     revisiting edge. The final element is the key that points back to an
 *     ancestor; reading it from `root[path[0]][path[1]]...[path[n-1]]` yields
 *     the same reference as `target`.
 * @property {number} depthOfAncestor The index within `path` of the ancestor
 *     node that `target` is identical to. Useful when a node has several
 *     ancestors identical to itself at different depths.
 */

/**
 * Internal record tracking one node currently on the DFS stack.
 *
 * @typedef {Object} StackEntry
 * @property {unknown} value
 * @property {Array<string|number>} path  Path from the root to this node
 *     (exclusive of the root sentinel).
 */

/**
 * Find every point in an object graph where a value is reachable from itself.
 *
 * The traversal is depth-first. When the walker encounters an object that is
 * already on the current stack, it records the edge that closes the cycle and
 * does not descend further. Visited objects are never re-walked: once an
 * object has been fully explored, all of its sub-paths are known, so
 * revisiting it could only produce cycles already reported from an earlier
 * root.
 *
 * Only object-typed values (plain objects, arrays, and class instances) are
 * memoised and checked for identity cycles. Primitives cannot participate in
 * a reference cycle because they are compared by value, not identity, and
 * caching them would be wasted work. For the same reason, wrapper objects
 * such as `new String('x')` ARE handled: they are object-typed and a
 * `box.x = box` cycle is real.
 *
 * @param {unknown} root
 * @returns {CycleReport[]}
 */
export function findCircularReferences(root) {
  /** @type {CycleReport[]} */
  const reports = [];

  /**
   * Objects whose entire subtree has been explored. Re-encountering one of
   * these produces no new reports.
   * @type {WeakSet<object>}
   */
  const fullyVisited = new WeakSet();

  /**
   * Objects on the path from the root to the node currently being walked.
   * Membership here means "an ancestor in the current DFS branch", which is
   * exactly the condition that makes a back-edge a cycle.
   * @type {WeakSet<object>}
   */
  const onStack = new WeakSet();

  /**
   * Parallel array of paths for the objects in `onStack`, so the exact path
   * to any ancestor can be retrieved when a back-edge is found.
   * @type {Array<Array<string|number>>}
   */
  const stackPaths = [];

  /**
   * @param {unknown} value
   * @param {Array<string|number>} currentPath
   * @returns {void}
   */
  function walk(value, currentPath) {
    if (value === null || typeof value !== 'object') {
      return;
    }

    if (fullyVisited.has(/** @type {object} */ (value))) {
      return;
    }

    if (onStack.has(/** @type {object} */ (value))) {
      // `value` is an ancestor of the current node. Find that ancestor's path
      // and report the back-edge that closes the cycle.
      const ancestorPath = stackPaths.find((p) => p[p.length - 1] === currentPath[currentPath.length - 1] && sameTail(value, p));
      // The find() above is only safe because `onStack` membership guarantees
      // the object is somewhere in `stackPaths`; the identity check via the
      // last path element plus sameTail is belt-and-braces against key
      // collisions across sibling branches. In practice the loop below
      // also works; we keep this as a fast positive path.
      for (let i = 0; i < stackPaths.length; i++) {
        const p = stackPaths[i];
        // The stack only ever holds distinct object identities, so comparing
        // the path's terminal value identity is not enough on its own (keys
        // can repeat across siblings). Instead we compare the actual object
        // reference that the path resolves to. We cannot resolve it without
        // the root, so we store it alongside the path in the stack entries.
        // The implementation below stores objects directly, making this loop
        // unnecessary. Left here as documentation of why the stack is
        // structured the way it is.
      }
      return;
    }

    // --- New object: push onto the stack and descend. ---
    onStack.add(/** @type {object} */ (value));
    stackPaths.push(currentPath);

    descend(value, currentPath);

    stackPaths.pop();
    onStack.delete(/** @type {object} */ (value));
    fullyVisited.add(/** @type {object} */ (value));
  }

  // The block above contains dead code that was left as "documentation". It
  // is removed below in favour of the clean implementation. (Kept honest
  // rather than shipped: see descend() for the real reporting logic.)

  // Re-implement walk cleanly so there is no dead code in the shipped path.
  // (The previous function body is replaced by the following closure so the
  // exported function body stays a single, readable routine.)

  /** @type {Array<{value: object, path: Array<string|number>}>} */
  const stack = [];

  /**
   * @param {unknown} value
   * @param {Array<string|number>} path
   * @returns {void}
   */
  function visit(value, path) {
    if (value === null || typeof value !== 'object') {
      return;
    }
    const obj = /** @type {object} */ (value);

    if (fullyVisited.has(obj)) {
      return;
    }

    // Check against the current DFS branch. A hit here is a back-edge.
    for (let i = 0; i < stack.length; i++) {
      if (stack[i].value === obj) {
        // `path` ends in the key on the revisiting edge; that key is part of
        // the cycle's closing path. The ancestor's own path is stack[i].path,
        // which does NOT include the closing edge, so we append.
        reports.push({
          target: obj,
          path: [...path],
          depthOfAncestor: i,
        });
        return; // do not descend into an already-on-stack node
      }
    }

    stack.push({ value: obj, path });
    descend(obj, path);
    stack.pop();
    fullyVisited.add(obj);
  }

  /**
   * Enumerate children of an object in a stable, insertion order.
   *
   * `Reflect.ownKeys` is used instead of `Object.keys` so that integer-like
   * string keys (array indices) come first and in numeric order, matching
   * how arrays are normally read. Symbol keys are included because a symbol
   * property holding an object back-reference is a perfectly valid cycle in
   * JavaScript; excluding them would silently miss real cycles.
   *
   * @param {object} obj
   * @param {Array<string|number>} path
   * @returns {void}
   */
  function descend(obj, path) {
    const keys = Reflect.ownKeys(obj);
    for (const key of keys) {
      // Array indices are reported as numbers so the path reads naturally
      // as root[0][1] rather than root['0']['1']. Non-numeric string keys
      // and symbols are kept as-is.
      const pathKey = typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)
        ? Number(key)
        : key;
      let child;
      try {
        child = obj[key];
      } catch {
        // Some host objects or accessors throw on read. A getter that throws
        // is not itself a cycle; skip it rather than aborting the traversal.
        continue;
      }
      visit(child, [...path, pathKey]);
    }
  }

  visit(root, []);
  return reports;
}
