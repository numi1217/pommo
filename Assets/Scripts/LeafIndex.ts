// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// LEAF scenario registration for the Desk Companion Lens.

import { scenariosIndex } from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator";
import { ScenarioMetadata } from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata";
import { DeskCompanionPlacementScenario } from "./DeskCompanionPlacementScenario";
import { DeskCompanionStepperIncrementScenario } from "./DeskCompanionStepperIncrementScenario";
import { DeskCompanionStepperDecrementScenario } from "./DeskCompanionStepperDecrementScenario";
import { DeskCompanionConfirmScenario } from "./DeskCompanionConfirmScenario";
import { DeskCompanionIKReachabilityScenario } from "./DeskCompanionIKReachabilityScenario";
import { DeskCompanionFocusStateSmokeScenario } from "./DeskCompanionFocusStateSmokeScenario";

@component
export class LeafIndex extends BaseScriptComponent {
    @scenariosIndex
    static scenariosIndex: ScenarioMetadata[] = [
        {
            id: "desk-companion-placement",
            typename: DeskCompanionPlacementScenario.getTypeName(),
        },
        {
            id: "desk-companion-stepper-increment",
            typename: DeskCompanionStepperIncrementScenario.getTypeName(),
        },
        {
            id: "desk-companion-stepper-decrement",
            typename: DeskCompanionStepperDecrementScenario.getTypeName(),
        },
        {
            id: "desk-companion-confirm",
            typename: DeskCompanionConfirmScenario.getTypeName(),
        },
        {
            id: "desk-companion-ik-reachability",
            typename: DeskCompanionIKReachabilityScenario.getTypeName(),
        },
        {
            id: "desk-companion-focus-state-smoke",
            typename: DeskCompanionFocusStateSmokeScenario.getTypeName(),
        },
    ];
}
