// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// LEAF scenario: IK reachability check for the timer popup's reach-sensitive
// buttons. Getting to the timer popup (placement -> intro dialogue ->
// calibration -> asking-task -> AI breakdown -> mission board) uses the
// normal simulated-hand/DebugPlacementTrigger interactor path (see
// DeskCompanionLeafInteractor.advanceToTimerPopup); once the popup is up,
// the "+" and Confirm buttons are triggered via a full-arm IK interactor —
// trigger() only succeeds if the reach ray actually converges on the
// target, so this doubles as proof a real user's arm can physically reach
// both buttons.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { expect } from "Leaf.lspkg/Utils/common/Expect";
import { findSceneObjectByName, sleep } from "Leaf.lspkg/Utils/common/Utils";
import { findInteractableByName } from "Leaf.lspkg/Interactors/InteractableUtils";
import { createIKInteractor } from "Leaf.lspkg/Interactors/interactor/ik/visualizer/BitmojiAvatar";
import { DeskCompanionLeafInteractor } from "./DeskCompanionLeafInteractor";

@component
export class DeskCompanionIKReachabilityScenario extends Scenario {
    async run(): Promise<void> {
        const handInteractor = new DeskCompanionLeafInteractor();

        await sleep(1500);
        await handInteractor.advanceToTimerPopup();

        expect(findSceneObjectByName("TimerPopup").enabled).toBe(true);

        const ik = createIKInteractor();
        const before = handInteractor.getMinutesValue();

        // Reach + trigger the "+" stepper button with a full IK arm.
        const plusButton = findInteractableByName("StepButton_+");
        await ik.trigger(plusButton);
        await sleep(300);
        // Step size mirrors DeskCompanionMain.MINUTE_STEP (creature.ts).
        expect(handInteractor.getMinutesValue()).toBe(before + 5);

        // Reach + trigger Confirm with a full IK arm.
        const confirmButton = findInteractableByName("ConfirmButton");
        await ik.trigger(confirmButton);
        await sleep(300);

        expect(findSceneObjectByName("TimerPopup").enabled).toBe(false);
        expect(findSceneObjectByName("CountdownText").enabled).toBe(true);
    }
}
