#!/usr/bin/env python3
"""
Local Eyes — Vision sub-system for opencode.

Sends images to a local Ollama vision model (Qwen2.5-VL) and returns a text
description that the main reasoning model can use as if it had seen the image.

TWO DISTINCT MODES — know which one to use:

  USER SHOWS YOU something (they took a screenshot):
      python vision.py                         → grab THEIR clipboard
      python vision.py "question?"             → their clipboard, focused
      python vision.py clipboard "question?"   → their clipboard, focused

  YOU WANT TO SEE something (take your own screenshot):
      python vision.py screen                  → capture full screen
      python vision.py screen "what error?"    → capture full screen, focused
      python vision.py <file_path>             → read a specific image file
      python vision.py <file_path> "question?" → read file, focused
      python vision.py -                       → read raw bytes from stdin

Configuration:
    Edit config.json to change model, host, or timeout.
    Environment variables (OLLAMA_HOST, OLLAMA_VISION_MODEL, OLLAMA_TIMEOUT)
    override the config file.
"""

import sys
import os
import io
import json
import base64
import urllib.request
from pathlib import Path

# ── configuration ────────────────────────────────────────────────────────────
#
# Load order (later overrides earlier):
#   1. Hardcoded defaults
#   2. config.json (next to this script)
#   3. Environment variables (OLLAMA_HOST, OLLAMA_VISION_MODEL, OLLAMA_TIMEOUT)

def _load_config() -> dict:
    """Load config from the config.json next to this script."""
    cfg = {}

    # 1. Try config.json next to the script
    config_path = Path(__file__).resolve().parent / "config.json"
    try:
        if config_path.is_file():
            with open(config_path) as f:
                cfg.update(json.load(f))
    except (json.JSONDecodeError, OSError):
        pass  # Silently ignore a broken config file

    # 2. Env vars override everything
    env_map = {
        "OLLAMA_HOST": "ollama_host",
        "OLLAMA_VISION_MODEL": "vision_model",
        "OLLAMA_TIMEOUT": "timeout_seconds",
    }
    for env_var, cfg_key in env_map.items():
        val = os.environ.get(env_var)
        if val:
            cfg[cfg_key] = val

    return cfg

_cfg = _load_config()

OLLAMA_HOST = _cfg.get("ollama_host", "http://localhost:11434")
OLLAMA_MODEL = _cfg.get("vision_model", "qwen2.5vl:7b")
TIMEOUT_SECONDS = int(_cfg.get("timeout_seconds", 120))

DEFAULT_SYSTEM_PROMPT = (
    "You are the vision sub-system for a reasoning AI that cannot see images. "
    "Your job is to produce an extremely detailed, precise textual description "
    "so the reasoning AI can make decisions as if it had seen the image itself. "
    "Describe every element, its position, color, state, and visible text verbatim. "
    "Never editorialize or summarize — report what is actually visible."
)

# Max context window for the vision model (in tokens).
# Override via OLLAMA_NUM_CTX env var or config.json "num_ctx" key.
NUM_CTX = int(_cfg.get("num_ctx", os.environ.get("OLLAMA_NUM_CTX", "8192")))

DEFAULT_USER_PROMPT = """Analyze this image in exhaustive detail. Include:

1. **Format**: Screenshot, photo, diagram, document, UI, terminal, chart, etc.
2. **Text**: ALL visible text transcribed VERBATIM — every label, error message,
   code line, number, timestamp, filename, URL.
3. **Layout**: Position of each element (top-left, centered, right panel, etc.).
   Grids, columns, rows, sidebars, tabs, menus, window frames.
4. **UI Components**: Buttons, inputs, dropdowns, modals, tooltips, status bars,
   icons, cursors, selection highlights, scrollbars.
5. **Colors & Theme**: Background colors, text colors, borders, dark/light mode,
   accent colors.
6. **State**: Active, disabled, hovered, selected, error, focused states.
7. **Purpose**: What task or information this image conveys."""


# ── image sources ────────────────────────────────────────────────────────────

def _capture_screen() -> bytes:
    """Take a screenshot of the entire screen. Returns PNG bytes."""
    try:
        from PIL import ImageGrab
    except ImportError:
        sys.exit(
            "Error: Pillow is required for screen capture.\n"
            "Install it with: pip install Pillow"
        )
    img = ImageGrab.grab()
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _clipboard_image() -> bytes | None:
    """Grab an image from the system clipboard. Returns PNG bytes or None."""
    try:
        from PIL import ImageGrab
    except ImportError:
        sys.exit(
            "Error: Pillow is required for clipboard support.\n"
            "Install it with: pip install Pillow"
        )

    img = ImageGrab.grabclipboard()

    if img is None:
        return None

    if isinstance(img, list):
        # Some platforms return a list of file paths
        if img and os.path.isfile(str(img[0])):
            return Path(str(img[0])).read_bytes()
        return None

    # PIL Image object
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── helpers ──────────────────────────────────────────────────────────────────

def encode_image(data: bytes) -> str:
    """Base64-encode raw image bytes."""
    return base64.b64encode(data).decode("ascii")


def check_ollama() -> bool:
    """Quick pre-flight: is Ollama reachable?"""
    try:
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/tags")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


def load_image_bytes(source: str) -> bytes:
    """
    Resolve a source string to raw image bytes.

    "screen" / "screenshot" → capture the entire screen now
    "clipboard" / "c"       → grab from system clipboard
    "-"                     → read raw bytes from stdin
    anything else           → treat as file path
    """
    if source in ("screen", "screenshot", "s"):
        return _capture_screen()

    if source in ("clipboard", "c"):
        data = _clipboard_image()
        if data is None:
            sys.exit(
                "Error: No image found on clipboard.\n"
                "Take a screenshot first (Win+Shift+S on Windows)."
            )
        return data

    if source == "-":
        return sys.stdin.buffer.read()

    path = Path(source)
    if not path.is_file():
        sys.exit(f"Error: File not found — '{source}'")
    return path.read_bytes()


def describe_image(image_bytes: bytes, prompt: str | None = None) -> str:
    """Send an image to the Ollama vision model and return its description."""
    user_prompt = prompt if prompt else DEFAULT_USER_PROMPT
    img_b64 = encode_image(image_bytes)

    # Use Ollama native API format (images array on the message),
    # not the OpenAI-compatible endpoint which doesn't support multimodal
    # content arrays in Ollama.
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "options": {
            "num_ctx": NUM_CTX,
        },
        "messages": [
            {"role": "system", "content": DEFAULT_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": user_prompt,
                "images": [img_b64],
            },
        ],
        "stream": False,
        "temperature": float(_cfg.get("temperature", 0.1)),
    }).encode("utf-8")

    url = f"{OLLAMA_HOST}/api/chat"
    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type": "application/json",
    })

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        sys.exit(
            f"Ollama API error (HTTP {e.code}): {body[:500]}"
        )
    except urllib.error.URLError as e:
        reason = str(e.reason)
        if "refused" in reason.lower() or "61" in reason:
            sys.exit(
                f"Error: Cannot reach Ollama at {OLLAMA_HOST}\n"
                "Is Ollama running? Try: ollama serve"
            )
        sys.exit(f"Error connecting to Ollama: {reason}")
    except KeyError:
        sys.exit(f"Unexpected Ollama response format.")
    except Exception as e:
        sys.exit(f"Ollama API error: {e}")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    # Fix Unicode output on Windows terminals (cp1252 → utf-8)
    if os.name == "nt":
        sys.stdout = io.TextIOWrapper(
            sys.stdout.buffer, encoding="utf-8", errors="replace"
        )

    if len(sys.argv) < 2:
        # No args = clipboard
        source = "clipboard"
        prompt = None
    elif sys.argv[1] in ("-h", "--help", "help"):
        print(__doc__)
        sys.exit(0)
    elif sys.argv[1] in ("screen", "screenshot", "s", "clipboard", "c"):
        # Explicit mode: screen or clipboard
        source = sys.argv[1]
        prompt = sys.argv[2] if len(sys.argv) > 2 else None
    elif sys.argv[1] == "-":
        # Stdin
        source = "-"
        prompt = sys.argv[2] if len(sys.argv) > 2 else None
    elif len(sys.argv) == 2 and not Path(sys.argv[1]).is_file():
        # Single non-file arg → treat as prompt for clipboard mode
        source = "clipboard"
        prompt = sys.argv[1]
    elif Path(sys.argv[1]).is_file():
        # File path
        source = sys.argv[1]
        prompt = sys.argv[2] if len(sys.argv) > 2 else None
    else:
        # Non-existent file path with extra args → likely clipboard + prompt
        # (e.g., "python vision.py what is this?" where argv[1]="what")
        source = "clipboard"
        prompt = " ".join(sys.argv[1:])

    # Pre-flight: is Ollama alive?
    if not check_ollama():
        sys.exit(
            f"Error: Cannot reach Ollama at {OLLAMA_HOST}\n"
            "Is Ollama running? Try: ollama serve"
        )

    image_bytes = load_image_bytes(source)
    description = describe_image(image_bytes, prompt)
    print(description)


if __name__ == "__main__":
    main()
