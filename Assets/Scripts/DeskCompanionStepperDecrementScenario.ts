// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// LEAF scenario: tapping "-" repeatedly decrements the minute stepper and
// clamps at MIN_MINUTES (5) — it must never read below 5 no matter how many
// extra taps land after the min. Raises off the default (which already
// equals the min) first so the decrement itself is exercised. Step size
// mirrors DeskCompanionMain.MINUTE_STEP (creature.ts) — keep in sync if
// that tunable changes.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { expect } from "Leaf.lspkg/Utils/common/Expect";
import { sleep } from "Leaf.lspkg/Utils/common/Utils";
import { DeskCompanionLeafInteractor } from "./DeskCompanionLeafInteractor";

@component
export class DeskCompanionStepperDecrementScenario extends Scenario {
    async run(): Promise<void> {
        const interactor = new DeskCompanionLeafInteractor();

        await sleep(1500);
        await interactor.advanceToTimerPopup();

        const start = interactor.getMinutesValue();

        // Raise a few minutes off the min so the decrement is meaningful.
        const raiseTaps = 3;
        for (let i = 0; i < raiseTaps; i++) {
            await interactor.tapStepButton("+");
        }
        expect(interactor.getMinutesValue()).toBe(start + raiseTaps * 5);

        // Decrement well past the min to verify the clamp holds at 5.
        for (let i = 0; i < raiseTaps + 12; i++) {
            await interactor.tapStepButton("-");
        }
        expect(interactor.getMinutesValue()).toBe(5);
    }
}
