// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// LEAF scenario: tapping Confirm hides the timer-setup popup and moves
// DeskCompanionMain from SettingTimer -> CountingDown, enabling the
// countdown display.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { expect } from "Leaf.lspkg/Utils/common/Expect";
import { findSceneObjectByName, sleep } from "Leaf.lspkg/Utils/common/Utils";
import { DeskCompanionLeafInteractor } from "./DeskCompanionLeafInteractor";

@component
export class DeskCompanionConfirmScenario extends Scenario {
    async run(): Promise<void> {
        const interactor = new DeskCompanionLeafInteractor();

        await sleep(1500);
        await interactor.advanceToTimerPopup();

        const timerPopup = findSceneObjectByName("TimerPopup");
        const countdownTextObj = findSceneObjectByName("CountdownText");

        expect(timerPopup.enabled).toBe(true);
        expect(countdownTextObj.enabled).toBe(false);

        await interactor.tapConfirm();
        await sleep(300);

        expect(timerPopup.enabled).toBe(false);
        expect(countdownTextObj.enabled).toBe(true);

        // Countdown display should now show a live mm:ss readout.
        const countdownText = countdownTextObj.getComponent("Component.Text3D") as Text3D;
        expect(/^\d+:\d{2}$/.test(countdownText.text)).toBe(true);
    }
}
