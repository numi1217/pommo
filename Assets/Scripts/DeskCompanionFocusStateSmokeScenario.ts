// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// LEAF scenario: smoke-test only. DeskCompanionCreature.setFocusState() is
// an intentionally-unwired EXTENSION POINT (see creature.ts) — nothing in
// the Lens calls it yet. This scenario does not test behavior; it only
// confirms calling it directly through all three FocusState values never
// throws, so a future focus/distraction detector has a safe hook to build
// on. Does not require placement — the creature instance exists as soon as
// DeskCompanionMain.onAwake() runs, regardless of phase.

import { Scenario } from "Leaf.lspkg/Scenarios/scenario/Scenario";
import { expect } from "Leaf.lspkg/Utils/common/Expect";
import { findSceneObjectByName, sleep } from "Leaf.lspkg/Utils/common/Utils";
import { DeskCompanionMain } from "./creature";
import { FocusState } from "./DeskCompanionCreature";

@component
export class DeskCompanionFocusStateSmokeScenario extends Scenario {
    async run(): Promise<void> {
        await sleep(1500);

        const root = findSceneObjectByName("DeskCompanion");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const main = root.getComponent(DeskCompanionMain.getTypeName()) as any;
        expect(main).toBeTruthy();
        expect(main.creature).toBeTruthy();

        main.creature.setFocusState(FocusState.Focused);
        expect(main.creature.getFocusState()).toBe(FocusState.Focused);

        main.creature.setFocusState(FocusState.Distracted);
        expect(main.creature.getFocusState()).toBe(FocusState.Distracted);

        main.creature.setFocusState(FocusState.Neutral);
        expect(main.creature.getFocusState()).toBe(FocusState.Neutral);
    }
}
