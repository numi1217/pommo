# Pommo README

Have you noticed you focus better in a coffee shop, or when studying with friends? Just
knowing other people are nearby — and might notice if you drift off — helps you stay on task.
Pommo brings that same feeling into your own space.

Pommo is a small creature that keeps you company while you work, built as an AR lens for Snap
Specs. Its name comes from the Pomodoro Technique — at the start, you set a focus timer from 5
to 25 minutes. If you pick up your phone or look away for too long, Pommo notices and gently
nudges you back, like a soft reminder rather than a scolding. Pommo also helps you get started:
big goals often feel too vague or too big to begin, so Pommo breaks them down into small, clear
steps, making starting feel easy instead of overwhelming.

## What It Does

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

## Core Functionality

The system runs a single guided flow: place Pommo on a real desk surface, hold your gaze on
the workspace for 10 seconds so it can calibrate a baseline "focused" direction, tell it (by
voice) what you want to work on, let it split that into 3 short sub-steps, pick a sub-step and
a timer duration, then focus while it watches — quietly, via gaze and on-device phone-presence
detection — and nudges you back only when it needs to.

The technology stack relies on "CLAD — Claude driving Lens Studio through MCP" for the
agentic build workflow, and on Snap's Remote Service Gateway for the AI task-breakdown call.

## Tech Stack

- TypeScript
- CLAD with Claude Code
- Spectacles Interaction Kit (SIK)
- Spectacles UIKit
- World Query Module
- ASR Module
- Remote Service Gateway + OpenAI
- On-device ML (`MLComponent` + Camera Module)
- Gaze/head-pose heuristic (camera-forward vector vs. calibrated baseline)

## Technical Requirements

The project requires Lens Studio 5.22 or newer (developed on 5.23.1), a signed-in Snap account
for Remote Service Gateway access, and Specs hardware for full functionality (voice input and
phone-detection in particular are device-only — see `REBUILD.md`), though the editor preview
handles most of the placement/UI/timer flow via built-in editor-only fallbacks.

This project also has a standing goal of downgrading to Lens Studio 5.15.4 for testing on
Spectacles (2024) hardware — see the portability notes throughout `REBUILD.md` and the code
comments in `Assets/Scripts/`.

## Documentation Structure

Setup instructions live in `SETUP.md`. Rebuild guidance, architecture, and known gotchas live
in `REBUILD.md`. The competition submission writeup lives in `SUBMISSION.md`. A full log of
Claude's involvement in development — every prompt and the AI-assisted actions taken in
response, across multiple sessions — lives in `CLAD_Prompt_Log.txt`. The `Cache/` and
`Support/` directories are auto-generated and not version-controlled.
