"""Extract the <memory> JSON block from a model response.

Stdlib only, so it can be tested without the app.
"""

from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Parsing: extract <memory> JSON block from Claude's raw response
# ---------------------------------------------------------------------------

_MEMORY_RE = re.compile(r"<memory>\s*(.*?)\s*</memory>", re.DOTALL)
_MEMORY_OPEN_RE = re.compile(r"<memory>\s*(.*)", re.DOTALL)


def parse_memory_block(raw_text: str) -> tuple[str, dict | None]:
    """Strip <memory> JSON from insight text. Returns (clean_text, memory_data).

    If no <memory> block is found, returns the original text and None.
    Handles truncated output where </memory> is missing.
    """
    match = _MEMORY_RE.search(raw_text)
    if match:
        json_str = match.group(1).strip()
        clean_text = raw_text[:match.start()].rstrip() + raw_text[match.end():]
        clean_text = clean_text.strip()
    else:
        # Try truncated: <memory> present but no closing tag
        open_match = _MEMORY_OPEN_RE.search(raw_text)
        if not open_match:
            return raw_text, None
        json_str = open_match.group(1).strip()
        clean_text = raw_text[:open_match.start()].rstrip()

    try:
        memory_data = json.loads(json_str)
    except json.JSONDecodeError:
        # Try to repair truncated JSON by closing open braces/brackets
        repaired = _repair_json(json_str)
        if repaired:
            memory_data = repaired
        else:
            logger.warning("Failed to parse <memory> JSON (even after repair attempt)")
            return clean_text, None

    return clean_text, memory_data


def _repair_json(s: str) -> dict | None:
    """Repair JSON that was cut off mid-output by closing what is still open.

    Drops an unfinished trailing item (a dangling comma, a key with no value,
    or a half-written string) and closes brackets in the order they opened.
    """
    stack: list[str] = []
    in_string = False
    escape = False
    # Length of the longest prefix that ends on a complete value, and the
    # bracket stack at that point.
    safe_len, safe_stack = 0, []
    for i, ch in enumerate(s):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if not stack or stack.pop() != ch:
                return None
            safe_len, safe_stack = i + 1, list(stack)
        elif ch == ",":
            safe_len, safe_stack = i, list(stack)

    if not stack:
        return None  # nothing left open: not a truncation problem

    candidates = []
    if not in_string:
        candidates.append((s.rstrip().rstrip(","), stack))
    candidates.append((s[:safe_len], safe_stack))

    for text, open_stack in candidates:
        try:
            data = json.loads(text + "".join(reversed(open_stack)))
        except json.JSONDecodeError:
            continue
        return data if isinstance(data, dict) else None
    return None


MEMORY_TOOL_NAME = "record_memory"


def split_response(blocks) -> tuple[str, dict | None]:
    """Split a model response into (analysis text, memory data).

    Memory arrives as the input of a record_memory tool call, which the API
    returns as an already-parsed object, so it cannot be malformed JSON. A
    <memory> block written into the text is still accepted as a fallback.
    """
    text = "\n".join(
        b.text for b in blocks if getattr(b, "type", None) == "text" and b.text
    ).strip()
    memory = next(
        (
            b.input for b in blocks
            if getattr(b, "type", None) == "tool_use"
            and b.name == MEMORY_TOOL_NAME
            and isinstance(b.input, dict)
        ),
        None,
    )
    clean_text, inline_memory = parse_memory_block(text)
    return clean_text, memory if memory is not None else inline_memory
