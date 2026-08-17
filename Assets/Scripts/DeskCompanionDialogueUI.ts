// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sequential dialogue popup shown right after placement, before calibration
// starts — a short scripted intro, each step typed out character-by-
// character with a synced "creature voice" chirp, gated by a button
// (Next / I'm ready / Okay). Panel/button use SpectaclesUIKit (BackPlate +
// Button); label stays plain Text3D — see DeskCompanionAskingTaskUI.ts for
// the same pattern.
//
// Plain class, not a @component — owned and driven by DeskCompanionMain;
// call update(deltaTime) every frame while a sequence is playing.

import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate";
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button";
import { setText3DColor } from "./Text3DHelpers";
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

const PANEL_W = 26;
const PANEL_H = 14;
const BUTTON_W = 10;
const BUTTON_H = 4.5;
// See DeskCompanionTimerUI's FRONT_Z comment — same reasoning.
const FRONT_Z = 0.6;

const CHAR_INTERVAL_SECONDS = 0.035; // typewriter reveal speed
const CHIRP_EVERY_N_CHARS = 3; // how often (in revealed characters) a voice chirp fires
const PAUSE_BETWEEN_LINES_SECONDS = 0.4; // beat between two lines in the same step, before auto-advancing

export interface DialogueStep {
    /** One or more sentences, typed out in sequence within this single step, before the button appears. */
    lines: string[];
    buttonLabel: string;
}

export class DeskCompanionDialogueUI {
    /** Fires once after the button on the final step is tapped. */
    public onComplete: Event<void> = new Event<void>();

    private root: SceneObject;
    private label: Text3D;
    private buttonObj: SceneObject;
    private button: Button;
    private buttonLabelText: Text3D;
    // One AudioComponent per chirp track, each bound ONCE at construction
    // and never reassigned — swapping .audioTrack on a single shared
    // AudioComponent before every play (every ~2 characters, i.e. many
    // times a second) forces a reload each time and was stalling the main
    // thread badly enough to freeze the typewriter itself.
    private chirpAudios: AudioComponent[] = [];

    private steps: DialogueStep[] = [];
    private stepIndex: number = 0;
    private lineIndex: number = 0;
    private currentFullText: string = "";
    private charIndex: number = 0;
    private typeAccumulator: number = 0;
    private isTyping: boolean = false;
    private isPausingBetweenLines: boolean = false;
    private pauseTimer: number = 0;

    constructor(
        owner: SceneObject,
        textMaterial: Material,
        font: Font,
        chirpTracks: AudioTrackAsset[]
    ) {
        this.root = owner;

        // Canvas required for UIKit's Hierarchy render-order sort — every
        // BackPlate/Button child paints in scene-object creation order.
        this.root.createComponent("Component.Canvas");

        const backPlate = this.root.createComponent(BackPlate.getTypeName()) as BackPlate;
        backPlate.size = new vec2(PANEL_W, PANEL_H);
        backPlate.style = "dark";

        this.label = this.makeLabel(this.root, "", 0, 2, 48, textMaterial, font, PANEL_W - 4, PANEL_H - 5);

        this.buttonObj = global.scene.createSceneObject("DialogueButton");
        this.buttonObj.setParent(this.root);
        this.buttonObj.getTransform().setLocalPosition(new vec3(0, -5, 0));
        this.button = this.buttonObj.createComponent(Button.getTypeName()) as Button;
        this.button.size = new vec3(BUTTON_W, BUTTON_H, 1);
        this.button.onTriggerUp.add(() => this.onButtonTap());
        this.buttonLabelText = this.makeLabel(this.buttonObj, "", 0, 0, 41, textMaterial, font, BUTTON_W - 2, BUTTON_H - 1.5);

        for (let i = 0; i < chirpTracks.length; i++) {
            const audioObj = global.scene.createSceneObject("DialogueChirp" + i);
            audioObj.setParent(this.root);
            const audio = audioObj.createComponent("Component.AudioComponent") as AudioComponent;
            audio.audioTrack = chirpTracks[i];
            this.chirpAudios.push(audio);
        }

        this.buttonObj.enabled = false;
        this.root.enabled = false;
    }

    /** Shows the popup at `worldPos`/`rotation` and begins the first step. */
    play(steps: DialogueStep[], worldPos: vec3, rotation: quat) {
        this.steps = steps;
        this.stepIndex = 0;

        const t = this.root.getTransform();
        t.setWorldPosition(worldPos);
        t.setWorldRotation(rotation);
        this.root.enabled = true;

        this.startStep();
    }

    hide() {
        this.root.enabled = false;
    }

    /** Call every frame while the popup is up (creature.ts's onUpdate, same as everything else). */
    update(deltaTime: number) {
        if (!this.root.enabled) return;

        if (this.isPausingBetweenLines) {
            this.pauseTimer -= deltaTime;
            if (this.pauseTimer <= 0) {
                this.isPausingBetweenLines = false;
                this.lineIndex++;
                this.startLine();
            }
            return;
        }

        if (!this.isTyping) return;

        this.typeAccumulator += deltaTime;
        while (this.typeAccumulator >= CHAR_INTERVAL_SECONDS && this.charIndex < this.currentFullText.length) {
            this.typeAccumulator -= CHAR_INTERVAL_SECONDS;
            this.charIndex++;
            this.label.text = this.currentFullText.substring(0, this.charIndex);
            if (this.charIndex % CHIRP_EVERY_N_CHARS === 0) {
                this.playChirp();
            }
        }

        if (this.charIndex >= this.currentFullText.length) {
            this.isTyping = false;
            this.onLineFinishedTyping();
        }
    }

    private startStep() {
        this.lineIndex = 0;
        this.buttonObj.enabled = false;
        this.startLine();
    }

    private startLine() {
        this.currentFullText = this.steps[this.stepIndex].lines[this.lineIndex];
        this.charIndex = 0;
        this.typeAccumulator = 0;
        this.isTyping = true;
        this.label.text = "";
    }

    private onLineFinishedTyping() {
        const step = this.steps[this.stepIndex];
        if (this.lineIndex < step.lines.length - 1) {
            this.isPausingBetweenLines = true;
            this.pauseTimer = PAUSE_BETWEEN_LINES_SECONDS;
        } else {
            this.buttonLabelText.text = step.buttonLabel;
            this.buttonObj.enabled = true;
        }
    }

    private onButtonTap() {
        this.buttonObj.enabled = false;
        this.stepIndex++;
        if (this.stepIndex >= this.steps.length) {
            this.hide();
            this.onComplete.invoke();
        } else {
            this.startStep();
        }
    }

    private playChirp() {
        if (this.chirpAudios.length === 0) return;
        const audio = this.chirpAudios[Math.floor(Math.random() * this.chirpAudios.length)];
        audio.play(1);
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
        // `size` (or long dynamic text) wraps and, failing that, shrinks —
        // it can never visually spill outside its box.
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
}
