# Setup

This repository ships **without live credentials** — the `RemoteServiceGatewayCredentials`
token fields in `Assets/Scene.scene` are blank. One place needs filling in before the AI
task-breakdown feature will work; everything else (placement, calibration, timer, mission
board UI) runs with no credentials at all.

## 1. Remote Service Gateway token (the path this Lens actually uses)

The Lens routes its one AI call — task breakdown, in `Assets/Scripts/TaskBreakdownService.ts`
— through Snap's Remote Service Gateway via `RemoteServiceGateway.lspkg/HostedExternal/OpenAI`,
so the request bills to Snap rather than a personal key. Tokens are **per-spec** and expire
roughly **hourly**.

1. Open the project in Lens Studio 5.22+ and **sign in with your Snap account**.
2. Find the `RemoteServiceGatewayCredentials` SceneObject in the scene and mint/paste a fresh
   `openAIToken` into its Inspector field, then save. (`googleToken` and `snapToken` are also
   present on this object but are not currently consumed by any script in this project — only
   `openAIToken` is required.)
3. Confirm task breakdown works by placing the companion, stating a task by voice (or, in
   Editor Preview, tapping the mic button — it fires a canned transcript automatically, since
   ASR only runs on physical Specs), and checking the mission board populates with 3 subtasks
   instead of falling back to the generic 3-way split.

If the call silently falls back to the generic split every time, check Lens Studio is signed in
**before** re-minting a token — re-minting while signed out returns nothing useful.

## 2. On-device features (optional, need physical Specs)

- **Voice task input** — `AsrModule` only runs on physical Specs. Editor Preview always
  reports "Nothing heard"; the Lens falls back to a canned task string in Preview so the rest
  of the flow stays testable without a device.
- **Phone-presence distraction detection** — optional. Leave `DeskCompanionMain`'s
  `phoneMlComponent` input empty to disable it entirely (gaze-based distraction still works on
  its own). To enable it, wire an `MLComponent` running the on-device phone-presence classifier
  (from the installed Object Detection / Household Objects Detection template) to that input,
  and re-tune `phoneDetectionThreshold` (currently `0.93`) against your own lighting/desk setup
  — see the threshold comment in `Assets/Scripts/creature.ts` for how that number was reached.

## Committing safely

`.gitignore` cannot protect a credential embedded in a tracked scene file.

- **`Assets/Scene.scene` can store RSG tokens in plaintext** if you paste them into the
  Inspector and save. Blank the three token fields before pushing to a public remote. They
  expire hourly, so nothing is lost by clearing them.
- Keep API keys as placeholders in source; never commit a live key.
- This repo currently has no git remote configured — check `git remote -v` before your first
  push and re-verify `Assets/Scene.scene`'s token fields are blank at that point, not just once.
