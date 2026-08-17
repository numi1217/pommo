// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Runtime-built timer-setup popup: title, -/+ minute stepper (clamped to
// [minMinutes, maxMinutes], default `defaultMinutes`), and a Confirm button
// below. Panel background and buttons use SpectaclesUIKit (BackPlate +
// Button) for a polished native look; labels stay plain Text3D with the
// project's existing manual layout (no FlexLayout — the fixed positions
// already work, so there's nothing FlexLayout would buy here).
//
// NOTE ON PORTABILITY: this pulls in SpectaclesUIKit.lspkg, which — unlike
// the rest of this project's hand-rolled UI — has not been verified to
// survive the 5.15 downgrade. The AI/voice features added this session
// (RemoteServiceGateway, AsrModule) already require a fresh 5.15
// compatibility pass regardless, so this isn't a new category of risk, just
// one more package to re-check in that pass.
//
// Plain class, not a @component — owned and driven by DeskCompanionMain.

import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate";
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button";
import { setText3DColor } from "./Text3DHelpers";
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

const PANEL_W = 22;
const PANEL_H = 14;
const BUTTON_SIZE = 4;
const CONFIRM_W = 14;
const CONFIRM_H = 4;
// Children sit slightly toward the viewer from the BackPlate's front face so
// nothing z-fights. The panel's rotation is set to match the camera's
// rotation exactly (see show() below), which means local +Z — not -Z — ends
// up facing the camera; +0.6 puts labels/button faces on the camera side.
const FRONT_Z = 0.6;

export class DeskCompanionTimerUI {
    /** Fires with the chosen minute count when the user taps Confirm. */
    public onConfirm: Event<number> = new Event<number>();

    private root: SceneObject;
    private minutesText: Text3D;
    private minutes: number;
    private readonly minMinutes: number;
    private readonly maxMinutes: number;
    private readonly step: number;

    constructor(
        owner: SceneObject,
        textMaterial: Material,
        font: Font,
        minMinutes: number,
        maxMinutes: number,
        defaultMinutes: number,
        step: number
    ) {
        this.root = owner;
        this.minMinutes = minMinutes;
        this.maxMinutes = maxMinutes;
        this.minutes = defaultMinutes;
        this.step = step;

        // Canvas required for UIKit's Hierarchy render-order sort — every
        // BackPlate/Button child paints in scene-object creation order.
        this.root.createComponent("Component.Canvas");

        const backPlate = this.root.createComponent(BackPlate.getTypeName()) as BackPlate;
        backPlate.size = new vec2(PANEL_W, PANEL_H);
        backPlate.style = "dark";

        this.makeLabel(this.root, "Set focus timer", 0, 5, 50, textMaterial, font, PANEL_W - 3, 3.5);
        this.minutesText = this.makeLabel(this.root, this.formatMinutes(), 0, 0.5, 67, textMaterial, font, 9, 5.5);

        this.makeStepButton("-", -7, textMaterial, font, () => this.adjustMinutes(-this.step));
        this.makeStepButton("+", 7, textMaterial, font, () => this.adjustMinutes(this.step));

        this.makeConfirmButton(textMaterial, font);

        this.root.enabled = false;
    }

    /**
     * Shows the popup at `worldPos`, matching `cameraRotation` exactly (not a
     * "face toward camera" lookAt — that flips local +X/-Z into a 180-degree
     * yaw relative to the camera, which mirrors button layout AND every
     * Text3D glyph into unreadable backwards text). Matching the camera's
     * own rotation keeps local +X = screen-right and renders glyphs correctly.
     */
    show(worldPos: vec3, cameraRotation: quat) {
        const t = this.root.getTransform();
        t.setWorldPosition(worldPos);
        t.setWorldRotation(cameraRotation);
        this.root.enabled = true;
    }

    hide() {
        this.root.enabled = false;
    }

    isVisible(): boolean {
        return this.root.enabled;
    }

    private adjustMinutes(delta: number) {
        const next = this.minutes + delta;
        this.minutes = Math.max(this.minMinutes, Math.min(this.maxMinutes, next));
        this.minutesText.text = this.formatMinutes();
    }

    private formatMinutes(): string {
        return `${this.minutes} min`;
    }

    private makeLabel(
        parent: SceneObject, text: string, x: number, y: number, size: number,
        textMaterial: Material, font: Font, boxWidth?: number, boxHeight?: number
    ): Text3D {
        const obj = global.scene.createSceneObject("Label");
        obj.setParent(parent);
        obj.getTransform().setLocalPosition(new vec3(x, y, FRONT_Z));

        const t3d = obj.createComponent("Component.Text3D") as Text3D;
        t3d.text = text;
        t3d.font = font;
        t3d.size = size;
        // Bounds the label to its slot within the panel/button so bumping
        // `size` can never visually spill outside its box — wraps first,
        // shrinks if it still doesn't fit.
        if (boxWidth !== undefined && boxHeight !== undefined) {
            t3d.worldSpaceRect = Rect.create(-boxWidth / 2, boxWidth / 2, -boxHeight / 2, boxHeight / 2);
            t3d.horizontalOverflow = HorizontalOverflow.Wrap;
            t3d.verticalOverflow = VerticalOverflow.Shrink;
        }

        const mat = textMaterial.clone();
        mat.mainPass.twoSided = true;
        setText3DColor(mat, new vec4(0.95, 0.95, 0.97, 1));
        t3d.mainMaterial = mat;
        return t3d;
    }

    private makeStepButton(
        label: string, x: number,
        textMaterial: Material, font: Font, onTap: () => void
    ) {
        const obj = global.scene.createSceneObject(`StepButton_${label}`);
        obj.setParent(this.root);
        obj.getTransform().setLocalPosition(new vec3(x, 0.5, 0));

        const btn = obj.createComponent(Button.getTypeName()) as Button;
        btn.size = new vec3(BUTTON_SIZE, BUTTON_SIZE, 1);
        btn.onTriggerUp.add(onTap);

        this.makeLabel(obj, label, 0, 0, 53, textMaterial, font, BUTTON_SIZE - 1, BUTTON_SIZE - 1);
    }

    private makeConfirmButton(textMaterial: Material, font: Font) {
        const obj = global.scene.createSceneObject("ConfirmButton");
        obj.setParent(this.root);
        obj.getTransform().setLocalPosition(new vec3(0, -5, 0));

        const btn = obj.createComponent(Button.getTypeName()) as Button;
        btn.size = new vec3(CONFIRM_W, CONFIRM_H, 1);
        btn.onTriggerUp.add(() => this.onConfirm.invoke(this.minutes));

        this.makeLabel(obj, "Start", 0, 0, 48, textMaterial, font, CONFIRM_W - 3, CONFIRM_H - 1.2);
    }
}
