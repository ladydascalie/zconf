---
name: local-eyes
description: >-
  VISION SUBSYSTEM — You have working eyes via a local Ollama vision model.
  TWO DISTINCT MODES: (1) User shows you something → python vision.py
  (grabs THEIR clipboard screenshot). (2) You want to see something →
  python vision.py screen (takes YOUR OWN screenshot of the display). Use
  PROACTIVELY during agentic workflows whenever seeing would help — after
  running a build, after deploying a server, when exploring image files on
  disk, when implementing a UI from a mockup, when debugging an error
  dialog, when a web page doesn't render as expected. If you think "I wish
  I could see this" — take a screenshot.
---

# Local Eyes — Your Vision Subsystem

**You are NOT blind.** You have a working vision subsystem via Ollama + Qwen2.5-VL.
It converts pixels into detailed text descriptions. There are **two completely different
ways to use it** — know which one applies.

## The two modes

| Mode | Command | When |
|------|---------|------|
| **User shows you** | `python vision.py` | User took a screenshot (Win+Shift+S) and wants you to see it |
| **You look yourself** | `python vision.py screen` | YOU decide you need to see what's on the display right now |

### Mode 1: User shows you something

The user took a screenshot (Win+Shift+S) — the image is on THEIR clipboard.
Grab it and look:

```bash
python vision.py                          # describe what the user screenshotted
python vision.py clipboard "what error?"  # focused question about user's screenshot
```

**Use this when:** user says "look at this", "what's wrong here", "see this",
or references a screenshot they just took.

### Mode 2: You take your own screenshot

You want to see what's on the screen RIGHT NOW. This captures the entire display:

```bash
python vision.py screen                           # full screen capture
python vision.py screen "What errors are shown?"  # focused question
python vision.py screen "Read all visible code"   # read code on screen
python vision.py screen "Describe the browser UI" # see the web page
```

**Use this when:** you're working agentically and need visual context —
after running a build, after starting a dev server, to check browser output,
to see error dialogs, to verify UI changes, etc.

### Mode 3: Read a specific file

```bash
python vision.py /path/to/screenshot.png
python vision.py ~/Pictures/mockup.jpg "Describe the layout"
```

## Proactive use — when to take a screenshot on your own

During agentic workflows, **you should take screenshots** in these situations:

| Scenario | Command |
|----------|---------|
| Just ran a build/tests and there's terminal output | `python vision.py screen "What build errors are visible?"` |
| Started a dev server and want to see the browser | `python vision.py screen "Describe the browser window"` |
| Finished implementing a UI component | `python vision.py screen "Does the rendered UI match the mockup?"` |
| Debugging — user mentions an error dialog is showing | `python vision.py screen "What does the error dialog say?"` |
| Exploring the repo, found .png/.jpg/.webp files | `python vision.py path/to/image.png` |
| User says "it's not working" but gives no details | `python vision.py screen` — look at their screen |
| After making CSS/style changes | `python vision.py screen "How does the page look now?"` |
| Verifying a CLI tool's output format | `python vision.py screen "Transcribe the terminal output"` |

**Rule of thumb:** If you're unsure what's on screen and seeing it would help,
run `python vision.py screen`. It takes ~5 seconds and gives you eyes.

## How to invoke — quick reference

```bash
# User's screenshot (THEIR clipboard)
python vision.py
python vision.py clipboard "question?"

# Your own eyes (take a screenshot NOW)
python vision.py screen
python vision.py screen "focused question?"

# Specific file
python vision.py path/to/image.png "question?"

# Stdin
some_tool | python vision.py -
```

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_VISION_MODEL` | `qwen2.5vl:7b` | Vision model |
| `OLLAMA_TIMEOUT` | `120` | Request timeout (seconds) |

## Critical rules

1. **`python vision.py` = user's clipboard.** Only use this when the user explicitly
   took a screenshot to show you. This is THEIR image, not yours.
2. **`python vision.py screen` = your own eyes.** Use this whenever YOU need to see
   what's happening on the display. This is your sight.
3. **NEVER hallucinate visuals.** If you're guessing what's on screen, stop and run
   `python vision.py screen` instead.
4. **Default to seeing.** In doubt? Take a screenshot. It's cheap, local, and instant.
5. **Ask focused questions.** Pass a specific question as the second argument when you
   need targeted information rather than a full description.
6. **On failure, guide the user.** "No image on clipboard" → they need Win+Shift+S.
   "Ollama unreachable" → they need `ollama serve`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "No image found on clipboard" | User needs Win+Shift+S first (MODE 1 issue — switch to MODE 2 with `screen`) |
| "Cannot reach Ollama" | `ollama serve` |
| "Model not found" | `ollama pull qwen2.5vl:7b` |
| Image too large / timeout | Crop or resize; screen captures are typically fine |
