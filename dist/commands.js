var ref = require("prosemirror-transform");
var joinPoint = ref.joinPoint;
var canJoin = ref.canJoin;
var findWrapping = ref.findWrapping;
var liftTarget = ref.liftTarget;
var canSplit = ref.canSplit;
var ReplaceAroundStep = ref.ReplaceAroundStep;
var ref$1 = require("prosemirror-model");
var Slice = ref$1.Slice;
var Fragment = ref$1.Fragment;
var ref$2 = require("prosemirror-state");
var Selection = ref$2.Selection;
var TextSelection = ref$2.TextSelection;
var NodeSelection = ref$2.NodeSelection;
var extendTransformAction = ref$2.extendTransformAction;
var ref$3 = require("extending-char");
var isExtendingCharAt = ref$3.isExtendingCharAt;

var ref$4 = require("./platform");
var mac = ref$4.mac;
var ref$5 = require("./char");
var charCategory = ref$5.charCategory;

// :: (EditorState, ?(action: Action)) → bool
// Delete the selection, if there is one.
function deleteSelection(state, onAction) {
  if (state.selection.empty) { return false }
  if (onAction) { onAction(state.tr.deleteSelection().scrollAction()) }
  return true
}
exports.deleteSelection = deleteSelection

// :: (EditorState, ?(action: Action)) → bool
// If the selection is empty and at the start of a textblock, move
// that block closer to the block before it, by lifting it out of its
// parent or, if it has no parent it doesn't share with the node
// before it, moving it into a parent of that node, or joining it with
// that.
function joinBackward(state, onAction) {
  var ref = state.selection;
  var $head = ref.$head;
  var empty = ref.empty;
  if (!empty || $head.parentOffset > 0) { return false }

  // Find the node before this one
  var before, cut
  for (var i = $head.depth - 1; !before && i >= 0; i--) { if ($head.index(i) > 0) {
    cut = $head.before(i + 1)
    before = $head.node(i).child($head.index(i) - 1)
  } }

  // If there is no node before this, try to lift
  if (!before) {
    var range = $head.blockRange(), target = range && liftTarget(range)
    if (target == null) { return false }
    if (onAction) { onAction(state.tr.lift(range, target).scrollAction()) }
    return true
  }

  // If the node below has no content and the node above is
  // selectable, delete the node below and select the one above.
  if (before.isLeaf && NodeSelection.isSelectable(before) && $head.parent.content.size == 0) {
    if (onAction) {
      var tr = state.tr.delete(cut, cut + $head.parent.nodeSize)
      tr.setSelection(NodeSelection.create(tr.doc, cut - before.nodeSize))
      onAction(tr.scrollAction())
    }
    return true
  }

  // If the node doesn't allow children, delete it
  if (before.isLeaf) {
    if (onAction) { onAction(state.tr.delete(cut - before.nodeSize, cut).scrollAction()) }
    return true
  }

  // Apply the joining algorithm
  return deleteBarrier(state, cut, onAction) || selectNextNode(state, cut, -1, onAction)
}
exports.joinBackward = joinBackward

// :: (EditorState, ?(action: Action)) → bool
// If the selection is empty and the cursor is at the end of a
// textblock, move the node after it closer to the node with the
// cursor (lifting it out of parents that aren't shared, moving it
// into parents of the cursor block, or joining the two when they are
// siblings).
function joinForward(state, onAction) {
  var ref = state.selection;
  var $head = ref.$head;
  var empty = ref.empty;
  if (!empty || $head.parentOffset < $head.parent.content.size) { return false }

  // Find the node after this one
  var after, cut
  for (var i = $head.depth - 1; !after && i >= 0; i--) {
    var parent = $head.node(i)
    if ($head.index(i) + 1 < parent.childCount) {
      after = parent.child($head.index(i) + 1)
      cut = $head.after(i + 1)
    }
  }

  // If there is no node after this, there's nothing to do
  if (!after) { return false }

  // If the node doesn't allow children, delete it
  if (after.isLeaf) {
    if (onAction) { onAction(state.tr.delete(cut, cut + after.nodeSize).scrollAction()) }
    return true
  }
  // Apply the joining algorithm
  return deleteBarrier(state, cut, onAction) || selectNextNode(state, cut, 1, onAction)
}
exports.joinForward = joinForward

// :: (EditorState, ?(action: Action)) → bool
// Delete the character before the cursor, if the selection is empty
// and the cursor isn't at the start of a textblock.
function deleteCharBefore(state, onAction) {
  var ref = state.selection;
  var $head = ref.$head;
  var empty = ref.empty;
  if (!empty || $head.parentOffset == 0) { return false }
  if (onAction) {
    var dest = moveBackward($head, "char")
    onAction(state.tr.delete(dest, $head.pos).scrollAction())
  }
  return true
}
exports.deleteCharBefore = deleteCharBefore

// :: (EditorState, ?(action: Action)) → bool
// Delete the word before the cursor, if the selection is empty and
// the cursor isn't at the start of a textblock.
function deleteWordBefore(state, onAction) {
  var ref = state.selection;
  var $head = ref.$head;
  var empty = ref.empty;
  if (!empty || $head.parentOffset == 0) { return false }
  if (onAction)
    { onAction(state.tr.delete(moveBackward($head, "word"), $head.pos).scrollAction()) }
  return true
}
exports.deleteWordBefore = deleteWordBefore

// :: (EditorState, ?(action: Action)) → bool
// Delete the character after the cursor, if the selection is empty
// and the cursor isn't at the end of its textblock.
function deleteCharAfter(state, onAction) {
  var ref = state.selection;
  var $head = ref.$head;
  var empty = ref.empty;
  if (!empty || $head.parentOffset == $head.parent.content.size) { return false }
  if (onAction)
    { onAction(state.tr.delete($head.pos, moveForward($head, "char")).scrollAction()) }
  return true
}
exports.deleteCharAfter = deleteCharAfter

// :: (EditorState, ?(action: Action)) → bool
// Delete the word after the cursor, if the selection is empty and the
// cursor isn't at the end of a textblock.
function deleteWordAfter(state, onAction) {
  var ref = state.selection;
  var $head = ref.$head;
  var empty = ref.empty;
  if (!empty || $head.parentOffset == $head.parent.content.size) { return false }
  if (onAction)
    { onAction(state.tr.delete($head.pos, moveForward($head, "word")).scrollAction()) }
  return true
}
exports.deleteWordAfter = deleteWordAfter

// :: (EditorState, ?(action: Action)) → bool
// Join the selected block or, if there is a text selection, the
// closest ancestor block of the selection that can be joined, with
// the sibling above it.
function joinUp(state, onAction) {
  var ref = state.selection;
  var node = ref.node;
  var from = ref.from;
  var point
  if (node) {
    if (node.isTextblock || !canJoin(state.doc, from)) { return false }
    point = from
  } else {
    point = joinPoint(state.doc, from, -1)
    if (point == null) { return false }
  }
  if (onAction) {
    var tr = state.tr.join(point)
    if (state.selection.node) { tr.setSelection(NodeSelection.create(tr.doc, point - state.doc.resolve(point).nodeBefore.nodeSize)) }
    onAction(tr.scrollAction())
  }
  return true
}
exports.joinUp = joinUp

// :: (EditorState, ?(action: Action)) → bool
// Join the selected block, or the closest ancestor of the selection
// that can be joined, with the sibling after it.
function joinDown(state, onAction) {
  var node = state.selection.node, nodeAt = state.selection.from
  var point = joinPointBelow(state)
  if (!point) { return false }
  if (onAction) {
    var tr = state.tr.join(point)
    if (node) { tr.setSelection(NodeSelection.create(tr.doc, nodeAt)) }
    onAction(tr.scrollAction())
  }
  return true
}
exports.joinDown = joinDown

// :: (EditorState, ?(action: Action)) → bool
// Lift the selected block, or the closest ancestor block of the
// selection that can be lifted, out of its parent node.
function lift(state, onAction) {
  var ref = state.selection;
  var $from = ref.$from;
  var $to = ref.$to;
  var range = $from.blockRange($to), target = range && liftTarget(range)
  if (target == null) { return false }
  if (onAction) { onAction(state.tr.lift(range, target).scrollAction()) }
  return true
}
exports.lift = lift

// :: (EditorState, ?(action: Action)) → bool
// If the selection is in a node whose type has a truthy
// [`code`](#model.NodeSpec.code) property in its spec, replace the
// selection with a newline character.
function newlineInCode(state, onAction) {
  var ref = state.selection;
  var $head = ref.$head;
  var anchor = ref.anchor;
  if (!$head || !$head.parent.type.spec.code || $head.sharedDepth(anchor) != $head.depth) { return false }
  if (onAction) { onAction(state.tr.insertText("\n").scrollAction()) }
  return true
}
exports.newlineInCode = newlineInCode

// :: (EditorState, ?(action: Action)) → bool
// When the selection is in a node with a truthy
// [`code`](#model.NodeSpec.code) property in its spec, create a
// default block after the code block, and move the cursor there.
function exitCode(state, onAction) {
  var ref = state.selection;
  var $head = ref.$head;
  var anchor = ref.anchor;
  if (!$head || !$head.parent.type.spec.code || $head.sharedDepth(anchor) != $head.depth) { return false }
  var above = $head.node(-1), after = $head.indexAfter(-1), type = above.defaultContentType(after)
  if (!above.canReplaceWith(after, after, type)) { return false }
  if (onAction) {
    var pos = $head.after(), tr = state.tr.replaceWith(pos, pos, type.createAndFill())
    tr.setSelection(Selection.near(tr.doc.resolve(pos), 1))
    onAction(tr.scrollAction())
  }
  return true
}
exports.exitCode = exitCode

// :: (EditorState, ?(action: Action)) → bool
// If a block node is selected, create an empty paragraph before (if
// it is its parent's first child) or after it.
function createParagraphNear(state, onAction) {
  var ref = state.selection;
  var $from = ref.$from;
  var $to = ref.$to;
  var node = ref.node;
  if (!node || !node.isBlock) { return false }
  var type = $from.parent.defaultContentType($to.indexAfter())
  if (!type || !type.isTextblock) { return false }
  if (onAction) {
    var side = ($from.parentOffset ? $to : $from).pos
    var tr = state.tr.insert(side, type.createAndFill())
    tr.setSelection(TextSelection.create(tr.doc, side + 1))
    onAction(tr.scrollAction())
  }
  return true
}
exports.createParagraphNear = createParagraphNear

// :: (EditorState, ?(action: Action)) → bool
// If the cursor is in an empty textblock that can be lifted, lift the
// block.
function liftEmptyBlock(state, onAction) {
  var ref = state.selection;
  var $head = ref.$head;
  var empty = ref.empty;
  if (!empty || $head.parent.content.size) { return false }
  if ($head.depth > 1 && $head.after() != $head.end(-1)) {
    var before = $head.before()
    if (canSplit(state.doc, before)) {
      if (onAction) { onAction(state.tr.split(before).scrollAction()) }
      return true
    }
  }
  var range = $head.blockRange(), target = range && liftTarget(range)
  if (target == null) { return false }
  if (onAction) { onAction(state.tr.lift(range, target).scrollAction()) }
  return true
}
exports.liftEmptyBlock = liftEmptyBlock

// :: (EditorState, ?(action: Action)) → bool
// Split the parent block of the selection. If the selection is a text
// selection, also delete its content.
function splitBlock(state, onAction) {
  var ref = state.selection;
  var $from = ref.$from;
  var $to = ref.$to;
  var node = ref.node;
  if (node && node.isBlock) {
    if (!$from.parentOffset || !canSplit(state.doc, $from.pos)) { return false }
    if (onAction) { onAction(state.tr.split($from.pos).scrollAction()) }
    return true
  }

  if (onAction) {
    var atEnd = $to.parentOffset == $to.parent.content.size
    var tr = state.tr.delete($from.pos, $to.pos)
    var deflt = $from.depth == 0 ? null : $from.node(-1).defaultContentType($from.indexAfter(-1))
    var types = atEnd ? [{type: deflt}] : null
    var can = canSplit(tr.doc, $from.pos, 1, types)
    if (!types && !can && canSplit(tr.doc, $from.pos, 1, [{type: deflt}])) {
      types = [{type: deflt}]
      can = true
    }
    if (can) {
      tr.split($from.pos, 1, types)
      if (!atEnd && !$from.parentOffset && $from.parent.type != deflt &&
          $from.node(-1).canReplace($from.index(-1), $from.indexAfter(-1), Fragment.from(deflt.create(), $from.parent)))
        { tr.setNodeType($from.before(), deflt) }
    }
    onAction(tr.scrollAction())
  }
  return true
}
exports.splitBlock = splitBlock

// :: (EditorState, ?(action: Action)) → bool
// Move the selection to the node wrapping the current selection, if
// any. (Will not select the document node.)
function selectParentNode(state, onAction) {
  var sel = state.selection, pos
  if (sel.node) {
    if (!sel.$from.depth) { return false }
    pos = sel.$from.before()
  } else {
    var same = sel.$head.sharedDepth(sel.anchor)
    if (same == 0) { return false }
    pos = sel.$head.before(same)
  }
  if (onAction) { onAction(NodeSelection.create(state.doc, pos).action()) }
  return true
}
exports.selectParentNode = selectParentNode

function joinMaybeClear(state, $pos, onAction) {
  var before = $pos.nodeBefore, after = $pos.nodeAfter, index = $pos.index()
  if (!before || !after || !before.type.compatibleContent(after.type)) { return false }
  if (!before.content.size && $pos.parent.canReplace(index - 1, index)) {
    if (onAction) { onAction(state.tr.delete($pos.pos - before.nodeSize, $pos.pos).scrollAction()) }
    return true
  }
  if (!$pos.parent.canReplace(index, index + 1)) { return false }
  if (onAction)
    { onAction(state.tr
             .clearNonMatching($pos.pos, before.contentMatchAt(before.childCount))
             .join($pos.pos)
             .scrollAction()) }
  return true
}

function deleteBarrier(state, cut, onAction) {
  var $cut = state.doc.resolve(cut), before = $cut.nodeBefore, after = $cut.nodeAfter, conn, match
  if (joinMaybeClear(state, $cut, onAction)) {
    return true
  } else if (after.isTextblock && $cut.parent.canReplace($cut.index(), $cut.index() + 1) &&
             (conn = (match = before.contentMatchAt(before.childCount)).findWrappingFor(after)) &&
             match.matchType((conn[0] || after).type, (conn[0] || after).attrs).validEnd()) {
    if (onAction) {
      var end = cut + after.nodeSize, wrap = Fragment.empty
      for (var i = conn.length - 1; i >= 0; i--)
        { wrap = Fragment.from(conn[i].type.create(conn[i].attrs, wrap)) }
      wrap = Fragment.from(before.copy(wrap))
      var tr = state.tr.step(new ReplaceAroundStep(cut - 1, end, cut, end, new Slice(wrap, 1, 0), conn.length, true))
      var joinAt = end + 2 * conn.length
      if (canJoin(tr.doc, joinAt)) { tr.join(joinAt) }
      onAction(tr.scrollAction())
    }
    return true
  } else {
    var selAfter = Selection.findFrom($cut, 1)
    var range = selAfter.$from.blockRange(selAfter.$to), target = range && liftTarget(range)
    if (target == null) { return false }
    if (onAction) { onAction(state.tr.lift(range, target).scrollAction()) }
    return true
  }
}

function selectNextNode(state, cut, dir, onAction) {
  var $cut = state.doc.resolve(cut)
  var node = dir > 0 ? $cut.nodeAfter : $cut.nodeBefore
  if (!node || !NodeSelection.isSelectable(node)) { return false }
  if (onAction)
    { onAction(NodeSelection.create(state.doc, cut - (dir > 0 ? 0 : node.nodeSize)).action()) }
  return true
}

// :: (ResolvedPos, string) → number
// Get an offset moving backward from a current offset inside a node. If by is "char", it will
// consider one character back. If it is "word" it will work from the current position backwards
// through text of a singular character category (e.g. "cat" of "#!*") until reaching a character
// in a different category (i.e. the beginning of the word).
// Note that this method is at this point unlikely to work reliably for non-European scripts.
function moveBackward($pos, by) {
  if (by != "char" && by != "word")
    { throw new RangeError("Unknown motion unit: " + by) }

  var parent = $pos.parent, offset = $pos.parentOffset

  var cat = null, counted = 0, pos = $pos.pos
  for (;;) {
    if (offset == 0) { return pos }
    var ref = parent.childBefore(offset);
    var start = ref.offset;
    var node = ref.node;
    if (!node) { return pos }
    if (!node.isText) { return cat ? pos : pos - 1 }

    if (by == "char") {
      for (var i = offset - start; i > 0; i--) {
        if (!isExtendingCharAt(node.text, i - 1))
          { return pos - 1 }
        offset--
        pos--
      }
    } else if (by == "word") {
      // Work from the current position backwards through text of a singular
      // character category (e.g. "cat" of "#!*") until reaching a character in a
      // different category (i.e. the end of the word).
      for (var i$1 = offset - start; i$1 > 0; i$1--) {
        var nextCharCat = charCategory(node.text.charAt(i$1 - 1))
        if (cat == null || counted == 1 && cat == "space") { cat = nextCharCat }
        else if (cat != nextCharCat) { return pos }
        offset--
        pos--
        counted++
      }
    }
  }
}
exports.moveBackward = moveBackward

// :: (ResolvedPos, string) → number
// Get an offset moving forward from a current offset inside a node. If by is "char", it will
// consider one character forward. If it is "word" it will work from the current position forward
// through text of a singular character category (e.g. "cat" of "#!*") until reaching a character
// in a different category (i.e. the end of the word).
// Note that this method is at this point unlikely to work reliably for non-European scripts.
function moveForward($pos, by) {
  if (by != "char" && by != "word")
    { throw new RangeError("Unknown motion unit: " + by) }

  var parent = $pos.parent, offset = $pos.parentOffset, pos = $pos.pos

  var cat = null, counted = 0
  for (;;) {
    if (offset == parent.content.size) { return pos }
    var ref = parent.childAfter(offset);
    var start = ref.offset;
    var node = ref.node;
    if (!node) { return pos }
    if (!node.isText) { return cat ? pos : pos + 1 }

    if (by == "char") {
      for (var i = offset - start; i < node.text.length; i++) {
        if (!isExtendingCharAt(node.text, i + 1))
          { return pos + 1 }
        offset++
        pos++
      }
    } else if (by == "word") {
      for (var i$1 = offset - start; i$1 < node.text.length; i$1++) {
        var nextCharCat = charCategory(node.text.charAt(i$1))
        if (cat == null || counted == 1 && cat == "space") { cat = nextCharCat }
        else if (cat != nextCharCat) { return pos }
        offset++
        pos++
        counted++
      }
    }
  }
}
exports.moveForward = moveForward

// Parameterized commands

function joinPointBelow(state) {
  var ref = state.selection;
  var node = ref.node;
  var to = ref.to;
  if (node) { return canJoin(state.doc, to) ? to : null }
  else { return joinPoint(state.doc, to, 1) }
}

// :: (NodeType, ?Object) → (state: EditorState, onAction: ?(action: Action)) → bool
// Wrap the selection in a node of the given type with the given
// attributes.
function wrapIn(nodeType, attrs) {
  return function(state, onAction) {
    var ref = state.selection;
    var $from = ref.$from;
    var $to = ref.$to;
    var range = $from.blockRange($to), wrapping = range && findWrapping(range, nodeType, attrs)
    if (!wrapping) { return false }
    if (onAction) { onAction(state.tr.wrap(range, wrapping).scrollAction()) }
    return true
  }
}
exports.wrapIn = wrapIn

// :: (NodeType, ?Object) → (state: EditorState, onAction: ?(action: Action)) → bool
// Returns a command that tries to set the textblock around the
// selection to the given node type with the given attributes.
function setBlockType(nodeType, attrs) {
  return function(state, onAction) {
    var ref = state.selection;
    var $from = ref.$from;
    var $to = ref.$to;
    var node = ref.node;
    var depth
    if (node) {
      depth = $from.depth
    } else {
      if (!$from.depth || $to.pos > $from.end()) { return false }
      depth = $from.depth - 1
    }
    var target = node || $from.parent
    if (!target.isTextblock || target.hasMarkup(nodeType, attrs)) { return false }
    var index = $from.index(depth)
    if (!$from.node(depth).canReplaceWith(index, index + 1, nodeType)) { return false }
    if (onAction) {
      var where = $from.before(depth + 1)
      onAction(state.tr
               .clearNonMatching(where, nodeType.contentExpr.start(attrs))
               .setNodeType(where, nodeType, attrs)
               .scrollAction())
    }
    return true
  }
}
exports.setBlockType = setBlockType

function markApplies(doc, from, to, type) {
  var can = false
  doc.nodesBetween(from, to, function (node) {
    if (can) { return false }
    can = node.isTextblock && node.contentMatchAt(0).allowsMark(type)
  })
  return can
}

// :: (MarkType, ?Object) → (state: EditorState, onAction: ?(action: Action)) → bool
// Create a command function that toggles the given mark with the
// given attributes. Will return `false` when the current selection
// doesn't support that mark. This will remove the mark if any marks
// of that type exist in the selection, or add it otherwise. If the
// selection is empty, this applies to the [stored
// marks](#state.EditorState.storedMarks) instead of a range of the
// document.
function toggleMark(markType, attrs) {
  return function(state, onAction) {
    var ref = state.selection;
    var empty = ref.empty;
    var from = ref.from;
    var to = ref.to;
    if (!markApplies(state.doc, from, to, markType)) { return false }
    if (onAction) {
      if (empty) {
        if (markType.isInSet(state.storedMarks || state.doc.marksAt(from)))
          { onAction({type: "removeStoredMark", markType: markType}) }
        else
          { onAction({type: "addStoredMark", mark: markType.create(attrs)}) }
      } else {
        if (state.doc.rangeHasMark(from, to, markType))
          { onAction(state.tr.removeMark(from, to, markType).scrollAction()) }
        else
          { onAction(state.tr.addMark(from, to, markType.create(attrs)).scrollAction()) }
      }
    }
    return true
  }
}
exports.toggleMark = toggleMark

function wrapOnActionForJoin(onAction, isJoinable) {
  return function (action) { return onAction(extendTransformAction(action, function (tr) {
    // Gather the ranges touched by the transform
    var ranges = []
    for (var i = 0; i < tr.mapping.maps.length; i++) {
      var map = tr.mapping.maps[i]
      for (var j = 0; j < ranges.length; j++)
        { ranges[j] = map.map(ranges[j]) }
      map.forEach(function (_s, _e, from, to) { return ranges.push(from, to); })
    }

    // Figure out which joinable points exist inside those ranges,
    // by checking all node boundaries in their parent nodes.
    var joinable = []
    for (var i$1 = 0; i$1 < ranges.length; i$1 += 2) {
      var from = ranges[i$1], to = ranges[i$1 + 1]
      var $from = tr.doc.resolve(from), depth = $from.sharedDepth(to), parent = $from.node(depth)
      for (var index = $from.indexAfter(depth), pos = $from.after(depth + 1); pos <= to; ++index) {
        var after = parent.maybeChild(index)
        if (!after) { break }
        if (index && joinable.indexOf(pos) == -1) {
          var before = parent.child(index - 1)
          if (before.type == after.type && isJoinable(before, after))
            { joinable.push(pos) }
        }
        pos += after.nodeSize
      }
    }
    // Join the joinable points
    joinable.sort(function (a, b) { return a - b; })
    for (var i$2 = joinable.length - 1; i$2 >= 0; i$2--) {
      if (canJoin(tr.doc, joinable[i$2])) { tr.join(joinable[i$2]) }
    }
  })); }
}

// :: ((state: EditorState, ?(action: Action)) → bool, union<(before: Node, after: Node) → bool, [string]>) → (state: EditorState, ?(action: Action)) → bool
// Wrap a command so that, when it produces a transform that causes
// two joinable nodes to end up next to each other, those are joined.
// Nodes are considered joinable when they are of the same type and
// when the `isJoinable` predicate returns true for them or, if an
// array of strings was passed, if their node type name is in that
// array.
function autoJoin(command, isJoinable) {
  if (Array.isArray(isJoinable)) {
    var types = isJoinable
    isJoinable = function (node) { return types.indexOf(node.type.name) > -1; }
  }
  return function (state, onAction) { return command(state, onAction && wrapOnActionForJoin(onAction, isJoinable)); }
}
exports.autoJoin = autoJoin

// :: (...[(EditorState, ?(action: Action)) → bool]) → (EditorState, ?(action: Action)) → bool
// Combine a number of command functions into a single function (which
// calls them one by one until one returns true).
function chainCommands() {
  var commands = [], len = arguments.length;
  while ( len-- ) commands[ len ] = arguments[ len ];

  return function(state, onAction) {
    for (var i = 0; i < commands.length; i++)
      { if (commands[i](state, onAction)) { return true } }
    return false
  }
}
exports.chainCommands = chainCommands

// :: Object
// A basic keymap containing bindings not specific to any schema.
// Binds the following keys (when multiple commands are listed, they
// are chained with [`chainCommands`](#commands.chainCommands):
//
// * **Enter** to `newlineInCode`, `createParagraphNear`, `liftEmptyBlock`, `splitBlock`
// * **Mod-Enter** to `exitCode`
// * **Backspace** to `deleteSelection`, `joinBackward`
// * **Mod-Backspace** to `deleteSelection`, `joinBackward`
// * **Delete** to `deleteSelection`, `joinForward`
// * **Mod-Delete** to `deleteSelection`, `joinForward`
// * **Alt-ArrowUp** to `joinUp`
// * **Alt-ArrowDown** to `joinDown`
// * **Mod-BracketLeft** to `lift`
// * **Escape** to `selectParentNode`
var baseKeymap = {
  "Enter": chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock),
  "Mod-Enter": exitCode,

  "Backspace": chainCommands(deleteSelection, joinBackward),
  "Mod-Backspace": chainCommands(deleteSelection, joinBackward),
  "Delete": chainCommands(deleteSelection, joinForward),
  "Mod-Delete": chainCommands(deleteSelection, joinForward),

  "Alt-ArrowUp": joinUp,
  "Alt-ArrowDown": joinDown,
  "Mod-BracketLeft": lift,
  "Escape": selectParentNode
}

if (mac) {
  var extra = {
    "Ctrl-h": baseKeymap["Backspace"],
    "Alt-Backspace": baseKeymap["Mod-Backspace"],
    "Ctrl-d": baseKeymap["Delete"],
    "Ctrl-Alt-Backspace": baseKeymap["Mod-Delete"],
    "Alt-Delete": baseKeymap["Mod-Delete"],
    "Alt-d": baseKeymap["Mod-Delete"]
  }
  for (var prop in extra) { baseKeymap[prop] = extra[prop] }
}

exports.baseKeymap = baseKeymap
