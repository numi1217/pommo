// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// LEAF scenario: pinch-to-place on a detected flat surface moves
// DeskCompanionMain through its full setup flow — PlacingSurface ->
// IntroDialogue (3-step scripted dialogue, see INTRO_DIALOGUE_STEPS in
// creature.ts) -> Calibrating (creature visible, calibration ring runs for
// CALIBRATION_DURATION_SECONDS) -> AskingTask (editor-fallback mic tap) ->
// BreakingDown (real breakDownTask() network call) -> MissionBoard (first
// card tapped) -> SettingTimer (timer popup appears).

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { expect } from "Leaf.lspkg/Utils/common/Expect";
import { findSceneObjectByName, sleep } from "Leaf.lspkg/Utils/common/Utils";
import { DeskCompanionLeafInteractor } from "./DeskCompanionLeafInteractor";

// Mirrors DeskCompanionMain.CALIBRATION_DURATION_SECONDS (creature.ts) —
// keep in sync if that tunable changes.
const CALIBRATION_DURATION_SECONDS = 10;

@component
export class DeskCompanionPlacementScenario extends Scenario {
    async run(): Promise<void> {
        const interactor = new DeskCompanionLeafInteractor();

        await sleep(1500);

        const creature = findSceneObjectByName("Creature");
        const calibrationUI = findSceneObjectByName("CalibrationUI");
        const timerPopup = findSceneObjectByName("TimerPopup");
        const confirmButton = findSceneObjectByName("ConfirmButton");

        // Pre-placement: everything hidden (PlacingSurface phase).
        expect(creature.enabled).toBe(false);
        expect(calibrationUI.enabled).toBe(false);
        expect(timerPopup.enabled).toBe(false);

        await interactor.pinchToPlace();
        await sleep(500);

        // Post-placement: creature visible immediately (IntroDialogue phase);
        // calibration ring doesn't appear until the scripted intro finishes.
        expect(creature.enabled).toBe(true);
        expect(calibrationUI.enabled).toBe(false);
        expect(timerPopup.enabled).toBe(false);

        await interactor.completeIntroDialogue();

        // Post-dialogue: calibration ring visible, timer popup still hidden (Calibrating phase).
        expect(calibrationUI.enabled).toBe(true);
        expect(timerPopup.enabled).toBe(false);

        await sleep((CALIBRATION_DURATION_SECONDS + 0.5) * 1000);

        // Post-calibration: ring hidden, asking-task popup visible (AskingTask phase).
        const askingTaskPopup = findSceneObjectByName("AskingTaskPopup");
        expect(calibrationUI.enabled).toBe(false);
        expect(askingTaskPopup.enabled).toBe(true);
        expect(timerPopup.enabled).toBe(false);

        await interactor.tapMic();
        await interactor.waitForMissionBoard();

        // Post-breakdown: mission board visible, timer popup still hidden (MissionBoard phase).
        const missionBoard = findSceneObjectByName("MissionBoard");
        expect(askingTaskPopup.enabled).toBe(false);
        expect(missionBoard.enabled).toBe(true);
        expect(timerPopup.enabled).toBe(false);

        await interactor.tapMissionCard(0);
        await sleep(300);

        // Post-card-tap: mission board hidden, full timer popup visible (SettingTimer phase).
        expect(missionBoard.enabled).toBe(false);
        expect(timerPopup.enabled).toBe(true);
        expect(confirmButton.enabled).toBe(true);
    }
}
