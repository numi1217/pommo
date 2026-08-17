# Pommo — Submission

## Public project repository

[https://github.com/numi1217/pommo](https://github.com/numi1217/pommo)

## Demo video

[https://drive.google.com/file/d/1h3hAz8_390MGUc7NUBJ5ETP790CQgbst/view?usp=sharing](https://drive.google.com/file/d/1h3hAz8_390MGUc7NUBJ5ETP790CQgbst/view?usp=sharing)

For a better on-device demo experience, this project was downgraded from Lens Studio 5.23 to
5.15.4 to record directly on Spectacles hardware — see `REBUILD.md` for the portability notes
that made that downgrade possible.

## CLAD prompt log

The full prompt transcript and AI-assisted workflow, across every development session, is
included in [CLAD_Prompt_Log.txt](CLAD_Prompt_Log.txt).

## Project description

Have you noticed you focus better in a coffee shop, or when studying with friends? Just
knowing other people are nearby — and might notice if you drift off — helps you stay on task.
Pommo brings that same feeling into your own space.

Pommo is a small creature that keeps you company while you work. Its name comes from the
Pomodoro Technique — at the start, you set a focus timer from 5 to 25 minutes. If you pick up
your phone or look away for too long, Pommo notices and gently nudges you back, like a soft
reminder rather than a scolding.

Pommo also helps you get started. Big goals often feel too vague or too big to begin. Pommo
breaks them down into small, clear steps, so starting feels easy instead of overwhelming.

**What it does:**

- **Pinch to place** — Pommo finds a spot on your real desk and settles in, turning to face
  wherever you're working.
- **Set your focus time** — a simple −/+ timer, 5 to 25 minutes.
- **Works beside you** — Pommo studies alongside you while you focus.
- **Presence check-ins** — every so often, a soft glance and sound just to confirm you're still
  there.
- **Phone detection** — the phone is the biggest distraction for most people, so when you pick
  it up, Pommo lets you know with a soft notification.
- **Gentle nudge back** — pick up your phone for too long, or look away, and Pommo calls you
  back warmly — no scolding, no lost progress.
- **Session complete** — mission ticked off, ready for the next one.

Pommo is for anyone who focuses better with a little quiet company nearby — students, remote
workers, and anyone who's ever opened one tab too many.

## How CLAD was used

CLAD supported the full build-and-test loop across multiple sessions: Lens Studio project
inspection, World Query surface placement, SIK hand-interaction wiring, UIKit + code-built UI
construction, ASR voice input, a Remote Service Gateway + OpenAI task-breakdown call, on-device
ML phone-presence detection, gaze-based distraction heuristics, LEAF automated test scenarios,
and direct runtime debugging via the Lens Studio MCP preview tools (including diagnosing a
stuck LEAF-plugin reset loop that was masking a real placement verification). The experience
emerged through repeated human-directed preview review and targeted CLAD-assisted
implementation changes — the complete record is in `CLAD_Prompt_Log.txt`.
