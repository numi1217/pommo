// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// LEAF scenario: tapping "+" repeatedly increments the minute stepper and
// clamps at MAX_MINUTES (25) — it must never read above 25 no matter how
// many extra taps land after the max. Step size mirrors
// DeskCompanionMain.MINUTE_STEP (creature.ts) — keep in sync if that
// tunable changes.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { expect } from "Leaf.lspkg/Utils/common/Expect";
import { sleep } from "Leaf.lspkg/Utils/common/Utils";
import { DeskCompanionLeafInteractor } from "./DeskCompanionLeafInteractor";

@component
export class DeskCompanionStepperIncrementScenario extends Scenario {
    async run(): Promise<void> {
        const interactor = new DeskCompanionLeafInteractor();

        await sleep(1500);
        await interactor.advanceToTimerPopup();

        const before = interactor.getMinutesValue();

        // Default is 5, step is 5, max is 25 -> 4 taps reaches the max
        // exactly; 2 more verify the clamp holds instead of overshooting.
        const tapsToMax = (25 - before) / 5;
        for (let i = 0; i < tapsToMax + 2; i++) {
            await interactor.tapStepButton("+");
        }

        expect(interactor.getMinutesValue()).toBe(25);
    }
}
