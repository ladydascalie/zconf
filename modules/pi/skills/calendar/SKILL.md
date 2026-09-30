---
name: calendar
description: Query and edit calendars through the vdirsyncer + khal + iCloud pipeline — see what's upcoming, add or change an event, regenerate and sync. Use when asked what's on the calendar, what's coming up or what's due, to add/move/remove or rename an event, to check a deadline, or when a dated action needs to land in a shared calendar.
---

# Calendar

Calendar events are **generated from a markdown table in a vault**, not typed into an app.
That table is the source of truth; iCloud is a replica.

```
<vault>/Reference/Key Dates.md ──<vault>/Meta/tools/gen_calendar.py──▶ ~/.local/share/vdirsyncer/calendars/Shared/*.ics
                                                                               │  vdirsyncer sync
                                                                               ▼
                                                                 iCloud "Shared"  ─▶  iPhone / Cerys
                                                                               │
                                                                              khal / ikhal
```

## Finding the vault

Don't assume. Look for the pair:

```sh
find ~ -name 'Key Dates.md' -path '*/Reference/*' -not -path '*/.trash/*' 2>/dev/null
```

Its `Meta/AGENTS.md` is authoritative for that vault's conventions — **read it before editing**.
The rest of this skill is the general mechanics.

## Answering "what's upcoming?"

```sh
khal list today 14d          # the next fortnight
khal list today 7d
khal list 2027-03-01 2027-03-24
```

- `khal` renders in `local_timezone` (Europe/London), **not** the event's own timezone. A 15:00
  check-in in Japan shows as **06:00**. Correct, just counter-intuitive — convert before reporting.
- The calendar is **shared and personal**: expect bin collections and driving lessons alongside trip
  events. Filter rather than dumping everything: `khal list today 180d | grep -iE 'trip prep|book:|cancel by'`.
- Always say **which timezone** a time is in when reporting it back.

## Adding or changing an event

1. Edit the event table in `<vault>/Reference/Key Dates.md`.
2. `python3 <vault>/Meta/tools/gen_calendar.py --dry-run` — check what will change.
3. `python3 <vault>/Meta/tools/gen_calendar.py` — write the `.ics` files.
4. `vdirsyncer sync shared` — push to iCloud.

The generator walks up from its own location to find the vault, so it runs from anywhere.

> **Sync is manual by choice.** There is no systemd timer or cron for `vdirsyncer` — the packaged
> `vdirsyncer.timer` is left disabled deliberately. Don't enable or add one unless asked. Consequence:
> after regenerating you **must** run `vdirsyncer sync <pair>`, and phone-side edits only show up in
> khal once a sync has happened.

### Table format

```
| Date | Time | Zone | Event | Detail | Alarm |
```

| Column | Rule |
|---|---|
| `Date` | `YYYY-MM-DD` |
| `Time` | `HH:MM`, or blank for an all-day event |
| `Zone` | `Asia/Tokyo` · `Asia/Shanghai` · `Europe/London`. Required if `Time` is set. Adding a zone means adding a `VTIMEZONE` block to the generator |
| `Event` | The summary. **Keep it short (≤ ~28 chars)** — it's what gets scanned on a phone |
| `Detail` | Becomes the description. **Must not contain a `|`.** Put addresses, phone numbers and notes here — they travel to the phone |
| `Alarm` | ICS duration before the event: `-P1D`, `-PT2H`. Blank = none |

Rows only parse if they match all six columns, so prose and other tables are ignored safely.

## Rules that must not be broken

- **Ownership.** The generator only ever touches its own events, marked by the
  `@<vault>.ladydascalie` UID suffix. Everything else in the calendar — hundreds of ordinary
  personal events — must stay untouched. Never widen the deletion filter.
- **Idempotence.** `DTSTAMP` is preserved on existing files, so a no-op regenerate writes nothing.
  If a second run reports `N written`, something is wrong — fix it before syncing, or you'll push
  churn to a shared calendar. New content must be compared with `newline=""`, because `read_text()`
  rewrites `\r\n` to `\n` and every comparison silently "changes".
- **UIDs are `date-time`, never title-derived.** That's what makes renaming update in place instead
  of delete-and-recreate. Changing a date or time *is* a new identity — that's intended.
- **Never let vdirsyncer "create" a collection.** It offers to when a collection name doesn't match,
  which silently makes a second empty calendar.

## Gotchas already paid for

| Symptom | Cause |
|---|---|
| `Unable to find collection 'X'` | iCloud collection **ids are UUIDs**, not display names. Use the three-element form: `collections = [["Shared", "Shared", "<uuid>"]]` |
| Prompted to create the collection | Same as above. **Answer no**, fix `collections`, re-discover |
| Events in iCloud, nothing in `khal` | Stale cache: `rm ~/.cache/khal/khal.db` |
| Event deleted and recreated | Its date or time changed — that's the UID |
| `[palette]` rejected | Entries take **2, 3 or 5** fields, **never 4**: `fg, bg, mono, fg_high, bg_high`. Fields 1–2 are ANSI names only — `gray` not `grey`, `dark cyan` not `cyan`. Fields 4–5 are unvalidated and take `#RRGGBB` (quoted), `h0`–`h255`, `g50`. A one-word colour still needs its comma: `key = dark red` is **1** field and fails with a misleading "must be of length, 2, 3, or 5" — write `dark red, ""` |
| Config value read as a list | A comma needs quoting, or configobj splits it — including the `#` in a hex colour, which would otherwise start a comment |
| `frame = True` | Invalid — `False` \| `width` \| `color` \| `top` |
| `firstweekday` ignored | It lives in `[locale]`; there is **no `[settings]` section** |
| A `[palette]` key seems ignored | Keys aren't validated, and upstream has name mismatches: the code asks for `button focus`, `edit focused`, `popupbg focus`, `editor`, `editor focus` and `date`, while the built-in themes ship the **typo'd** `button focused` and `edit focus` (and neither atom for the editor pane). Style the name the *code* uses — check `ui/*.py`, not `colors.py` |
| `calendar` / `popupbg` palette keys change nothing | `_add_calendar_colors` builds `calendar <name>` from the *built-in* theme **before** the config palette is merged. Event colours come from `[calendars] color`, which takes an ANSI name, a `0`–`255` index, or a quoted `#RRGGBB` |

### `[palette]` semantics

The 2-field form is enough on a Catppuccin terminal because urwid falls back `fg_high → fg`, and a
standard colour name in the high slot still emits an **ANSI** code (`foreground_basic`), so the
terminal's own palette — i.e. Mocha — resolves it. Consequence: the look silently changes with the
terminal theme. Pinning `'#bac2de', '#1e1e2e'` in the 5-field form is the only way to be
terminal-independent. Verify a change with `khal printcalendars`, then read the real SGR codes
(`tmux capture-pane -e`) — the palette merges after the calendar colours, so some keys are inert.

Field 3 is the **mono** slot — it only applies on a 1-colour terminal, so a `bold` there is inert on
a colour one (the built-in themes use it and it does nothing). Modifiers belong in fields 4–5:
`'light gray,bold'` gives bold + the terminal's light gray, `'#bac2de,bold'` gives bold + that exact
colour. Separately, `bold_for_light_color = true` makes urwid emit bright ANSI names 8–15 as
`1;30`–`1;37`, which is why `dark gray` renders bold-black.

The event list's day-header rows are `date header` / `date header focused` / `date header selected`
(set by `DateListBox.render`); `date` is only the transient reset state written by `DListBox.clean()`.
Style all four or the row changes look as focus moves. **Do not** read boldness off
`tmux capture-pane -e` by looking for `1m`: it emits *incremental* SGR, so a surviving bold shows up
as a **missing** `0m` reset rather than a fresh `1m`. A/B the same row against the unmodified config.

## Config outside any vault

| What | Where |
|---|---|
| vdirsyncer | `~/.config/vdirsyncer/config` |
| iCloud app-specific password | `~/.config/vdirsyncer/icloud.pass` (0600) |
| khal / ikhal | `~/.config/khal/config` |

**Never put secrets in a vault.** Prefer targeted edits to these files — a full overwrite of the
vdirsyncer config has already destroyed a hand-added username once.

## Verify after any change

```sh
khal printcalendars                      # config still valid
vdirsyncer sync shared                   # second run must report nothing
```

A second sync that prints no `Copying`/`Deleting` lines means both sides converged. That is the
only real proof the change landed correctly.
