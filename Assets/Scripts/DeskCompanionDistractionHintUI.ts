// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// HUD-locked "Still with me?" / "Distracted by phone?" nudge shown on the
// edge into FocusState.Distracted (see creature.ts's onDistractionDetected).
// Same typewriter-reveal + synced creature-voice-chirp treatment as the
// intro dialogue (see DeskCompanionDialogueUI.ts) — no button here, though:
// it just types out and stays up until the user refocuses.
//
// Plain class, not a @component — owned and driven by DeskCompanionMain;
// call update(deltaTime) every frame while up, and setWorldPose(...) every
// frame to keep it HUD-locked (creature.ts's tickDistraction already does
// this for the panel itself every frame regardless of whether it's shown).

import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate";
import { setText3DColor } from "./Text3DHelpers";

const PANEL_W = 18;
const PANEL_H = 5;
// See DeskCompanionTimerUI's FRONT_Z comment — same reasoning.
const FRONT_Z = 0.6;

const CHAR_INTERVAL_SECONDS = 0.035; // matches DeskCompanionDialogueUI's typewriter speed
const CHIRP_EVERY_N_CHARS = 3;

export class DeskCompanionDistractionHintUI {
    private root: SceneObject;
    private label: Text3D;
    // One AudioComponent per chirp track, bound once and never reassigned —
    // see DeskCompanionDialogueUI.ts for why reassigning .audioTrack per
    // play() call stalls the main thread badly enough to freeze typing.
    private chirpAudios: AudioComponent[] = [];

    private currentFullText: string = "";
    private charIndex: number = 0;
    private typeAccumulator: number = 0;
    private isTyping: boolean = false;

    constructor(owner: SceneObject, textMaterial: Material, font: Font, chirpTracks: AudioTrackAsset[]) {
        this.root = owner;

        this.root.createComponent("Component.Canvas");

        const backPlate = this.root.createComponent(BackPlate.getTypeName()) as BackPlate;
        backPlate.size = new vec2(PANEL_W, PANEL_H);
        backPlate.style = "dark";

        this.label = this.makeLabel(this.root, "", 0, 0, 46, textMaterial, font, PANEL_W - 3, PANEL_H - 1.5);

        for (let i = 0; i < chirpTracks.length; i++) {
            const audioObj = global.scene.createSceneObject("DistractionHintChirp" + i);
            audioObj.setParent(this.root);
            const audio = audioObj.createComponent("Component.AudioComponent") as AudioComponent;
            audio.audioTrack = chirpTracks[i];
            this.chirpAudios.push(audio);
        }

        this.root.enabled = false;
    }

    isVisible(): boolean {
        return this.root.enabled;
    }

    /** Shows the popup at `worldPos`/`rotation` and begins typewriting `text`. */
    show(text: string, worldPos: vec3, rotation: quat) {
        this.currentFullText = text;
        this.charIndex = 0;
        this.typeAccumulator = 0;
        this.isTyping = true;
        this.label.text = "";

        const t = this.root.getTransform();
        t.setWorldPosition(worldPos);
        t.setWorldRotation(rotation);
        this.root.enabled = true;
    }

    hide() {
        this.root.enabled = false;
        this.isTyping = false;
    }

    /** Repositions the already-shown panel — call every frame for a HUD-locked panel (matches DeskCompanionCalibrationUI's setWorldPose). */
    setWorldPose(worldPos: vec3, rotation: quat) {
        const t = this.root.getTransform();
        t.setWorldPosition(worldPos);
        t.setWorldRotation(rotation);
    }

    /** Call every frame while up (creature.ts's onUpdate). */
    update(deltaTime: number) {
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
        // Bounds the label to its slot within the panel so bumping `size`
        // can never visually spill outside it — wraps first, shrinks if it
        // still doesn't fit.
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
