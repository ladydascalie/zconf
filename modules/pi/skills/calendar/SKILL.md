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
| `[palette]` rejected | Only the 16 ANSI names; no hex, and `gray` not `grey` |
| Config value read as a list | A comma needs quoting, or configobj splits it |
| `frame = True` | Invalid — `False` \| `width` \| `color` \| `top` |
| `firstweekday` ignored | It lives in `[locale]`; there is **no `[settings]` section** |

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
