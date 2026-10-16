#!/usr/bin/env python3
"""Refresh standard semicolon-terminated HTML named references in the codec.

Data source: Python's HTML5 entity table, derived from the HTML standard.
https://docs.python.org/3/library/html.entities.html
No runtime Python dependency is introduced.
"""
import html
import html.entities
import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "web/editor/amorist-markdown-codec.js"
source = path.read_text()
start = source.index("  // BEGIN generated HTML character references")
end = source.index("  // END generated HTML character references", start)
references = {name[:-1]: value for name, value in html.entities.html5.items() if name.endswith(";")}
generated = "  // BEGIN generated HTML character references\n  const HTML_CHARACTER_REFERENCES = "
generated += json.dumps(references, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + ";\n"
numeric = {str(value): html.unescape(f"&#{value};") for value in range(0x80, 0xa0)
           if html.unescape(f"&#{value};") != chr(value)}
generated += "  const HTML_NUMERIC_REPLACEMENTS = " + json.dumps(numeric, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + ";\n"
source = source[:start] + generated + source[end:]
start = source.index("  // Unicode default case folding;")
end = source.index("\n\n", start)
fold = {chr(value): chr(value).casefold() for value in range(0x110000)
        if chr(value).casefold() != chr(value)}
generated = "  // Unicode default case folding; generated from Python str.casefold.\n  const REFERENCE_CASE_FOLD = "
generated += json.dumps(fold, ensure_ascii=True, separators=(",", ":")) + ";"
path.write_text(source[:start] + generated + source[end:])
print(f"Generated {len(references)} HTML named character references")
