// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Runtime-built mission tracker board: a title (today's stated task) and 3
// subtask cards, each tap-to-start and each showing a "Done" tick once its
// timer finishes. Panel background and cards use SpectaclesUIKit
// (BackPlate + Button) for a polished native look; labels stay plain
// Text3D with the project's existing manual layout — see
// DeskCompanionTimerUI.ts for the portability note on pulling in UIKit.
//
// Plain class, not a @component — owned and driven by DeskCompanionMain,
// which also owns the per-subtask timer and decides when a card is
// re-selectable (done cards are gated in DeskCompanionMain, not here).

import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate";
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button";
import { setText3DColor } from "./Text3DHelpers";
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

const PANEL_W = 28;
const PANEL_H = 24;
const CARD_W = 22;
const CARD_H = 4.5;
const CARD_GAP = 5.5;
// Vertical position of the first (topmost) card's center — leaves room for
// the title above and keeps the last card's bottom edge inside the panel.
const FIRST_CARD_Y = 5.5;
const SUBTASK_COUNT = 3;
// See DeskCompanionTimerUI's FRONT_Z comment — same reasoning.
const FRONT_Z = 0.6;

const DONE_TEXT_COLOR = new vec4(0.6, 0.95, 0.65, 1);

export class DeskCompanionMissionBoardUI {
    /** Fires with the tapped card's index (0-2). DeskCompanionMain decides whether that subtask is still startable. */
    public onSubtaskSelected: Event<number> = new Event<number>();

    private root: SceneObject;
    private titleText: Text3D;
    private labelTexts: Text3D[] = [];
    private statusTexts: Text3D[] = [];

    constructor(
        owner: SceneObject,
        textMaterial: Material,
        font: Font
    ) {
        this.root = owner;

        // Canvas required for UIKit's Hierarchy render-order sort — every
        // BackPlate/Button child paints in scene-object creation order.
        this.root.createComponent("Component.Canvas");

        const backPlate = this.root.createComponent(BackPlate.getTypeName()) as BackPlate;
        backPlate.size = new vec2(PANEL_W, PANEL_H);
        backPlate.style = "dark";

        // Title sits at PANEL_H/2 - 1.5 (was -2.5) with a shorter box (3.2,
        // was 4.5) — at the old offset/box its own box edge dipped 0.5 units
        // below the first card's top edge, so the title could visually
        // overlap the mission list beneath it. This keeps clear headroom.
        this.titleText = this.makeLabel(this.root, "Today's Mission", 0, PANEL_H / 2 - 1.5, 46, textMaterial, font, new vec4(0.95, 0.95, 0.97, 1), PANEL_W - 4, 3.2);

        for (let i = 0; i < SUBTASK_COUNT; i++) {
            const y = FIRST_CARD_Y - i * CARD_GAP;

            const cardObj = global.scene.createSceneObject(`MissionCard_${i}`);
            cardObj.setParent(this.root);
            cardObj.getTransform().setLocalPosition(new vec3(0, y, 0));

            const btn = cardObj.createComponent(Button.getTypeName()) as Button;
            btn.size = new vec3(CARD_W, CARD_H, 1);
            const index = i;
            btn.onTriggerUp.add(() => this.onSubtaskSelected.invoke(index));

            const label = this.makeLabel(cardObj, "", 0, 0.8, 31, textMaterial, font, new vec4(0.95, 0.95, 0.97, 1), CARD_W - 3, 2.4);
            this.labelTexts.push(label);

            const status = this.makeLabel(cardObj, "", 0, -1.5, 24, textMaterial, font, DONE_TEXT_COLOR, CARD_W - 3, 1.4);
            this.statusTexts.push(status);
        }

        this.root.enabled = false;
    }

    /** Shows the popup at `worldPos`, matching `cameraRotation` exactly — see DeskCompanionTimerUI.show for why. */
    show(worldPos: vec3, cameraRotation: quat) {
        const t = this.root.getTransform();
        t.setWorldPosition(worldPos);
        t.setWorldRotation(cameraRotation);
        this.root.enabled = true;
    }

    hide() {
        this.root.enabled = false;
    }

    setTask(taskText: string) {
        this.titleText.text = `Today: ${taskText}`;
    }

    setSubtasks(subtasks: string[]) {
        for (let i = 0; i < SUBTASK_COUNT; i++) {
            this.labelTexts[i].text = subtasks[i] ?? "";
        }
    }

    setSubtaskDone(index: number, done: boolean) {
        this.statusTexts[index].text = done ? "Done" : "";
    }

    private makeLabel(
        parent: SceneObject, text: string, x: number, y: number, size: number,
        textMaterial: Material, font: Font, color: vec4, boxWidth?: number, boxHeight?: number
    ): Text3D {
        const obj = global.scene.createSceneObject("Label");
        obj.setParent(parent);
        obj.getTransform().setLocalPosition(new vec3(x, y, FRONT_Z));

        const t3d = obj.createComponent("Component.Text3D") as Text3D;
        t3d.text = text;
        t3d.font = font;
        t3d.size = size;
        // Bounds the label to its slot within the panel/card so bumping
        // `size` (or long AI-generated subtask text) wraps and, failing
        // that, shrinks — it can never visually spill outside its box.
        if (boxWidth !== undefined && boxHeight !== undefined) {
            t3d.worldSpaceRect = Rect.create(-boxWidth / 2, boxWidth / 2, -boxHeight / 2, boxHeight / 2);
            t3d.horizontalOverflow = HorizontalOverflow.Wrap;
            t3d.verticalOverflow = VerticalOverflow.Shrink;
        }

        const mat = textMaterial.clone();
        mat.mainPass.twoSided = true;
        setText3DColor(mat, color);
        t3d.mainMaterial = mat;
        return t3d;
    }
}
