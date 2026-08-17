// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// LEAF interactor for the Desk Companion flow.
//
// Placement in production is a raw HandInputData.getInstance().getHand("right")
// .onPinchDown listener in DeskCompanionMain (creature.ts) — NOT a SIK
// Interactable. That raw-pinch path is gated on native isTracked() hand
// state, which neither LEAF's simulated hand nor PreviewInteractTool's
// Gesture/Pinch actions can reliably drive in Editor Preview (confirmed via
// LEAF testing in a prior pass). DeskCompanionMain now exposes an
// editor-only "DebugPlacementTrigger" SceneObject (isEditor() gated, zero
// footprint on-device) that is a real TapInteraction/Interactable wrapping
// the exact same onPinch() -> hit-test -> placeCompanion() call a real pinch
// would make. pinchToPlace() drives that trigger via the normal trigger()
// path instead of the simulated hand.
//
// The timer-popup buttons (StepButton_-, StepButton_+, ConfirmButton) ARE
// SIK Interactables (TapInteraction wraps Interactable — see TapInteraction.ts),
// so they go through the normal trigger() path inherited from
// DefaultLeafInteractor.

import { DefaultLeafInteractor } from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor";
import { findInteractablesByName } from "Leaf.lspkg/Interactors/InteractableUtils";
import {
    findSceneObject,
    findSceneObjectByName,
    matchSceneObjectName,
    matchSceneObjectParentName,
    sleep,
} from "Leaf.lspkg/Utils/common/Utils";

// Mirrors DeskCompanionMain.CALIBRATION_DURATION_SECONDS (creature.ts) —
// keep in sync if that tunable changes.
const CALIBRATION_DURATION_SECONDS = 10;

export class DeskCompanionLeafInteractor extends DefaultLeafInteractor {
    /**
     * Taps the editor-only DebugPlacementTrigger (see creature.ts
     * createDebugPlacementTrigger()) which invokes DeskCompanionMain's
     * onPinch() directly — the same hit-test -> placeCompanion() path a
     * real pinch drives. The trigger follows the preview camera's forward
     * position each frame (see onUpdate), so it's reachable regardless of
     * camera pose; whether placement actually succeeds still depends on
     * WorldQueryModule finding a flat surface (normal.y > 0.7) within 200cm
     * along the camera's forward ray at the moment of the tap.
     *
     * IMPORTANT — camera pose is an external precondition this method
     * cannot establish itself: in Interactive Preview, DeviceTracking
     * drives the Camera Object's transform every frame from the simulated
     * walkthrough pose, so a one-shot `setWorldRotation()` from inside a
     * script (tried and confirmed a no-op — the scenario hung, then
     * resumed working once the *editor's* Preview camera was
     * repositioned externally instead) gets overwritten almost
     * immediately. Whoever drives this scenario (a human, or an
     * orchestrating agent via the MovePreviewCamera tool) needs to aim
     * the Preview camera down at the floor — matching how a real user
     * looks at their desk before pinching — before calling this.
     */
    async pinchToPlace(): Promise<void> {
        const trigger = findInteractablesByName("DebugPlacementTrigger", undefined, true)[0];
        if (!trigger) {
            throw new Error("DebugPlacementTrigger not found or not enabled");
        }
        await this.trigger(trigger);
        await sleep(150);
    }

    async tapStepButton(sign: "-" | "+"): Promise<void> {
        const button = findInteractablesByName(`StepButton_${sign}`, undefined, true)[0];
        if (!button) {
            throw new Error(`StepButton_${sign} not found or not enabled`);
        }
        await this.trigger(button);
        await sleep(150);
    }

    async tapConfirm(): Promise<void> {
        const button = findInteractablesByName("ConfirmButton", undefined, true)[0];
        if (!button) {
            throw new Error("ConfirmButton not found or not enabled");
        }
        await this.trigger(button);
        await sleep(200);
    }

    /**
     * Advances through the scripted intro dialogue (see INTRO_DIALOGUE_STEPS
     * in creature.ts) that now runs between placement and calibration. Each
     * step's button (SceneObject name "DialogueButton", reused across all
     * three steps) only enables once that step finishes typewriting — see
     * DeskCompanionDialogueUI.onLineFinishedTyping() — so this waits out the
     * slowest step's typing + inter-line pause before every tap rather than
     * hardcoding per-step durations that would need to stay in sync with
     * CHAR_INTERVAL_SECONDS/PAUSE_BETWEEN_LINES_SECONDS.
     */
    async completeIntroDialogue(): Promise<void> {
        for (let i = 0; i < 3; i++) {
            await sleep(3000);
            const button = findInteractablesByName("DialogueButton", undefined, true)[0];
            if (!button) {
                throw new Error(`DialogueButton not found or not enabled (step ${i + 1}/3)`);
            }
            await this.trigger(button);
            await sleep(150);
        }
    }

    /**
     * Taps the AskingTaskPopup mic button. In Editor Preview (the only place
     * LEAF runs against Lens Studio preview) DeskCompanionAskingTaskUI's
     * onMicTap() takes the isEditor() branch and fires a canned transcript
     * synchronously — no real ASR round trip to wait out.
     */
    async tapMic(): Promise<void> {
        const button = findInteractablesByName("MicButton", undefined, true)[0];
        if (!button) {
            throw new Error("MicButton not found or not enabled");
        }
        await this.trigger(button);
        await sleep(150);
    }

    async tapMissionCard(index: number): Promise<void> {
        const button = findInteractablesByName(`MissionCard_${index}`, undefined, true)[0];
        if (!button) {
            throw new Error(`MissionCard_${index} not found or not enabled`);
        }
        await this.trigger(button);
        await sleep(150);
    }

    /**
     * Polls for the mission board instead of a fixed sleep — onTaskStated()
     * kicks off a real breakDownTask() network call (see TaskBreakdownService),
     * whose duration isn't something a test can predict. breakDownTask()
     * never rejects (it falls back to a generic split on network/parse
     * failure), so this only needs to wait, not handle an error path.
     */
    async waitForMissionBoard(timeoutMs: number = 15000): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const missionBoard = findSceneObjectByName("MissionBoard");
            if (missionBoard && missionBoard.enabled) return;
            await sleep(300);
        }
        throw new Error("MissionBoard did not appear within timeout — task breakdown may have stalled");
    }

    /**
     * Full setup flow from a bare Lens load through to the timer popup:
     * pinch-to-place -> intro dialogue -> calibration hold -> asking-task
     * (editor-fallback mic tap) -> AI breakdown (polled) -> mission board
     * (taps the first card). Shared by every scenario that needs the timer
     * popup up, instead of each re-deriving (and silently drifting out of
     * sync with) the real flow.
     */
    async advanceToTimerPopup(): Promise<void> {
        await this.pinchToPlace();
        await this.completeIntroDialogue();
        await sleep((CALIBRATION_DURATION_SECONDS + 1) * 1000);
        await this.tapMic();
        await this.waitForMissionBoard();
        await sleep(300);
        await this.tapMissionCard(0);
        await sleep(300);
    }

    /**
     * The minutes-value Label and the "Set focus timer" title Label are both
     * unnamed "Label" direct children of TimerPopup, so name+parent alone is
     * ambiguous. Disambiguate by content: only the minutes label's text
     * contains "min" (see DeskCompanionTimerUI.formatMinutes).
     */
    getMinutesText(): string {
        const obj = findSceneObject((so: SceneObject) => {
            if (!matchSceneObjectName("Label")(so)) return undefined;
            if (!matchSceneObjectParentName("TimerPopup")(so)) return undefined;
            const t3d = so.getComponent("Component.Text3D") as Text3D;
            return t3d && t3d.text.includes("min") ? so : undefined;
        });
        if (!obj) {
            throw new Error("Minutes label not found under TimerPopup");
        }
        return (obj.getComponent("Component.Text3D") as Text3D).text;
    }

    getMinutesValue(): number {
        return parseInt(this.getMinutesText(), 10);
    }
}
