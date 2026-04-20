"""Robust JSON extraction from LLM text (fences, preamble, greedy-regex-safe)."""
from __future__ import annotations

import json
from typing import Any


def strip_json_fences(text: str) -> str:
    t = text.strip()
    if not t.startswith("```"):
        return t
    lines = t.splitlines()
    if lines and lines[0].strip().startswith("```"):
        lines = lines[1:]
    while lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def first_balanced_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def first_balanced_json_array(text: str) -> str | None:
    start = text.find("[")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def parse_llm_json_dict(raw: str) -> dict[str, Any] | None:
    if not raw or not raw.strip():
        return None
    for chunk in (strip_json_fences(raw), raw.strip()):
        chunk = chunk.strip()
        if chunk.startswith("{"):
            try:
                obj = json.loads(chunk)
                return obj if isinstance(obj, dict) else None
            except json.JSONDecodeError:
                pass
        inner = first_balanced_json_object(chunk)
        if inner:
            try:
                obj = json.loads(inner)
                return obj if isinstance(obj, dict) else None
            except json.JSONDecodeError:
                continue
    return None


def parse_llm_json_array(raw: str) -> list[Any]:
    """Parse a JSON array from model output; accepts a single object and wraps it in a list."""
    if not raw or not raw.strip():
        raise ValueError("No JSON array in model response")
    for chunk in (strip_json_fences(raw), raw.strip()):
        chunk = chunk.strip()
        if chunk.startswith("["):
            try:
                v = json.loads(chunk)
                if isinstance(v, list):
                    return v
            except json.JSONDecodeError:
                pass
        inner = first_balanced_json_array(chunk)
        if inner:
            try:
                v = json.loads(inner)
                if isinstance(v, list):
                    return v
            except json.JSONDecodeError:
                pass
        obj = parse_llm_json_dict(chunk)
        if obj:
            return [obj]
    raise ValueError("No JSON array in model response")
