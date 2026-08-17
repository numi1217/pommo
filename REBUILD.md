# Desk Companion Recreation — Complete Overview

## Core Architecture

The Desk Companion Lens is a Specs-based AR focus tool built with Claude + Lens Studio MCP
(CLAD), across multiple sessions. It runs as one authored root SceneObject
(`Assets/Scripts/creature.ts`, class `DeskCompanionMain`) that builds everything else — the
creature body, every popup, and every button — at runtime from code, so the scene stays
trivially reconstructible.

## Main Pipeline

`DeskCompanionMain` drives a linear phase state machine:

```
PlacingSurface -> IntroDialogue -> Calibrating -> AskingTask -> BreakingDown
  -> MissionBoard -> SettingTimer -> CountingDown -> (back to MissionBoard, or) Complete
```

- **PlacingSurface** — `WorldQueryModule` hit-tests the camera-forward ray against real
  surfaces; a live translucent placement preview follows whatever surface is currently in view
  so the user sees where a pinch will land before committing.
- **IntroDialogue** — a short scripted, typewriter-style intro (see `INTRO_DIALOGUE_STEPS`).
- **Calibrating** — 10 seconds holding gaze on the workspace; the camera's forward vector is
  sampled every frame and averaged into `baselineForward`, the reference direction distraction
  detection compares against later.
- **AskingTask** — voice prompt ("what do you want to achieve today?") via `AsrModule`.
- **BreakingDown** — one Remote Service Gateway + OpenAI call (`TaskBreakdownService.ts`)
  splits the stated task into exactly 3 short sub-steps, racing a timeout against a generic
  3-way-split fallback so the flow never dead-ends on a bad/stalled response.
- **MissionBoard** — 3 subtask cards; tapping one starts it.
- **SettingTimer** — `-`/`+` stepper, 5–25 minutes, step 5, default 5; Confirm button.
- **CountingDown** — the actual focus session. `tickDistraction()` combines two independent
  signals (gaze deviation from `baselineForward`, and an optional on-device phone-presence
  classifier) into one sustain/hysteresis state machine driving
  `DeskCompanionCreature.setFocusState(Focused | Distracted | Neutral)` — every reaction is a
  gentle color-tint shift plus an optional short hint, never a harsher cue.

## Feature List

- Pinch-to-place with live WYSIWYG surface preview (`WorldQueryModule`)
- 10-second gaze calibration
- Voice task input (`AsrModule`), with an Editor-Preview canned-transcript fallback
- AI task breakdown (Remote Service Gateway + OpenAI), with a timeout + fallback split
- Mission board / subtask selection
- Focus-timer stepper + countdown
- Dual-signal distraction detection (gaze + on-device ML phone-presence classifier)
- Optional custom creature body (`creatureModelPrefab`) with a 5-frame blink sequence, falling
  back to a procedural gradient sphere when left empty
- Optional desk prop (`bookPencilPrefab`) shown only during the countdown
- LEAF automated test scenarios covering placement, stepper, confirm, and the focus-state hook

## Critical Authentication & Token Management

The Lens uses a `RemoteServiceGatewayCredentials` SceneObject with `openAIToken` (the only
field this project's code actually reads — via `RemoteServiceGateway.lspkg`'s `OpenAI`
wrapper). **This component missing from the scene silently breaks the AI call with no visible
error** — if task breakdown always falls back to the generic 3-way split, check this object
exists and is wired before debugging the network call itself. See `SETUP.md` for minting steps.
Tokens are per-spec and expire roughly hourly.

**Do not store live tokens in `Assets/Scene.scene` in a repo you intend to push.** This project
had live tokens committed to local git history early on; they were blanked out and history was
not rewritten (RSG tokens expire hourly, so the exposure window was already closed) — but this
is exactly the mistake to avoid on a fresh rebuild. See `SETUP.md`'s "Committing safely" section.

## Essential Gotchas

**Script Safety:** Editing a wired `.ts` file in place is safe; deleting and recreating a
script asset drops the scene's `ScriptComponent.scriptAsset` link silently and needs manual
re-wiring afterward.

**`quat.lookAt` mirrors layout:** Billboarding a UI panel or the countdown text toward the
camera with `quat.lookAt` produces a 180-degree yaw relative to the camera, which mirrors both
button layout and every `Text3D` glyph into backwards, unreadable text. Fix: set the panel's
rotation to match the camera's own rotation directly (`camera.getTransform().getWorldRotation()`),
not a "look at" quaternion, and rely on `twoSided` materials to handle the resulting normal
direction.

**SIK `Interactable` registration race:** Subscribe to `Interactable`/`TapInteraction` events
inside `OnStartEvent`, not `onAwake` — the `Interactable` finishes registering with SIK's
`InteractionManager` during its own `onAwake`, so subscribing earlier can race that and silently
miss events.

**Editor Preview cannot reliably drive raw hand-tracking pinches:** `DeskCompanionMain`'s real
placement path listens on raw `HandInputData.onPinchDown`, gated on native `isTracked()` hand
state. Neither LEAF's simulated hand nor the MCP `PreviewInteractTool`'s Gesture/Pinch actions
reliably drive that native flag in Editor Preview. Fix used here: an `isEditor()`-gated
`DebugPlacementTrigger` — a small tappable SIK `Interactable` that invokes the exact same
`onPinch() -> hit-test -> placeCompanion()` path a real pinch would, with zero footprint
on-device. The same convention (an `isEditor()`-only tappable proxy calling the real handler)
is reused for the mic button's canned-transcript fallback.

**LEAF plugin can get stuck resetting the Lens:** observed once in this project — the LEAF
plugin process kept reloading its settings, re-registering all scenarios, and resetting the
live Lens roughly once per second, even with no LEAF panel actually docked. This tears down the
runtime scene before any async call (e.g. the surface hit-test) can complete, which looks
exactly like a hang from the outside — reproduced identically via direct `PreviewInteractTool`
calls with no LEAF scenario running at all. If placement (or anything else async) appears to
hang in Preview with no errors, check the Lens Studio log for repeated `"Lens has been reset"`
lines before assuming it's an app bug; a Lens Studio restart cleared it.

**`SceneObject.getComponentsInDescendants` doesn't exist in Lens Studio 5.15** — use the
portable helper in `SceneObjectHelpers.ts` instead if touching anything that walks a
hierarchy, for this project's eventual 5.15 downgrade.

**Global `setTimeout` doesn't exist in the 5.15 target either** — use a `DelayedCallbackEvent`
bound via `hostScript.createEvent("DelayedCallbackEvent")` instead (see the timeout pattern in
`TaskBreakdownService.ts`). Its delay is frame-time, not wall-clock — it only advances while
the Lens is actually rendering frames.

**Prefab edits vs. live Preview-instance edits:** the creature (and any `creatureModelPrefab`)
is rebuilt fresh from its prefab asset every run. Scaling or otherwise editing a live Preview
instance does not persist — edit the prefab asset itself. Also check for duplicate/orphaned
prefab files with similar names before assuming a fix landed on the right one; this project hit
exactly that once during its 5.15 migration.

**Distraction-detection hysteresis:** a sustain timer must be reset symmetrically in both
directions (deviating from baseline, and returning to it) — an earlier version only reset one
direction, letting a persistent false-positive signal snap back to "focused" almost instantly
and re-trigger the alert every few seconds. `MIN_ALERT_INTERVAL_SECONDS` throttles the
sound/hint only; the creature's tint itself stays fully immediate and unthrottled.

**On-device ML threshold tuning:** the phone-presence classifier's confidence threshold needed
raising from an initial `0.85` to `0.93` after real on-device testing — a single static test
image reads very differently from a live, cluttered desk scene under real lighting. Re-tune
from live readings, not a single reference photo.

**Text overflow:** use Lens Studio's world-space-rect + wrap/shrink text overflow handling on
every label, so increasing a font size can never visually spill outside its panel or button
regardless of dynamic text length (task names, subtask text, etc. vary a lot).

## Deployment / Portability Notes

This project has a standing goal of downgrading to Lens Studio 5.15.4 for Spectacles (2024)
device testing (see the `spectacles-522-portable-design` skill for the full rule set). Most of
the codebase follows those rules — runtime-built scene, `ImageMaterialPreset` base materials
with all state set in code on every clone (5.15 `clone()` resets Inspector values), no custom
graph shaders, `MeshBuilder`-based geometry throughout.

**Open risk for the eventual downgrade:** several of the newer UI panels
(`DeskCompanionAskingTaskUI`, `DeskCompanionDialogueUI`, `DeskCompanionMissionBoardUI`,
`DeskCompanionTimerUI`) import `SpectaclesUIKit.lspkg`'s `BackPlate` and `Button` — built in
code, not hand-authored in the editor, but still a 5.22+ UIKit dependency that hasn't yet been
verified against the 5.15 target. Confirm these compile and render correctly against a 5.15
UIKit version before relying on them post-downgrade; fall back to the original
`MeshBuilder + Text3D + TapInteraction` pattern (still used by the base creature/placement code)
if they don't.
