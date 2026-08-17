// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Runtime-built "what do you want to achieve today?" popup: instruction
// label, live transcript label, status line, and a tap-to-toggle mic
// button. Panel background and the mic button use SpectaclesUIKit
// (BackPlate + Button) for a polished native look; labels stay plain
// Text3D with the project's existing manual layout — see
// DeskCompanionTimerUI.ts for the portability note on pulling in UIKit.
//
// ASR (LensStudio:AsrModule) only runs on physical Specs — Editor Preview
// always reports "Nothing heard" (see specs-asr skill). In isEditor(), the
// mic button instead immediately fires a canned transcript so the mission
// flow is testable without a device, mirroring the DebugPlacementTrigger
// convention used elsewhere in this project.
//
// Plain class, not a @component — owned and driven by DeskCompanionMain.

import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate";
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button";
import { setText3DColor } from "./Text3DHelpers";
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

const PANEL_W = 26;
const PANEL_H = 16;
const MIC_BUTTON_SIZE = 6;
// See DeskCompanionTimerUI's FRONT_Z comment — same reasoning.
const FRONT_Z = 0.6;

const EDITOR_FALLBACK_TASK = "Clean up my desk";

export class DeskCompanionAskingTaskUI {
    /** Fires once with the final task text — either a real ASR transcript (on-device) or the editor-fallback string (in Preview). */
    public onTaskStated: Event<string> = new Event<string>();

    private root: SceneObject;
    private statusText: Text3D;
    private transcriptText: Text3D;
    private micLabelText: Text3D;

    private asrModule: AsrModule = require("LensStudio:AsrModule");
    private isListening: boolean = false;

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

        // Tighter vertical cluster than the original layout (labels used to
        // read as disconnected, floating far apart) — instruction/transcript/
        // status now sit close together as one visual group above the mic.
        this.makeLabel(this.root, "What do you want to achieve today?", 0, 5.5, 43, textMaterial, font, PANEL_W - 4, 5);
        this.transcriptText = this.makeLabel(this.root, "", 0, 1, 46, textMaterial, font, PANEL_W - 4, 6);
        this.statusText = this.makeLabel(this.root, "Tap the mic to speak", 0, -3.3, 36, textMaterial, font, PANEL_W - 4, 2.6);

        const micObj = global.scene.createSceneObject("MicButton");
        micObj.setParent(this.root);
        micObj.getTransform().setLocalPosition(new vec3(0, -9.5, 0));

        const micBtn = micObj.createComponent(Button.getTypeName()) as Button;
        micBtn.size = new vec3(MIC_BUTTON_SIZE, MIC_BUTTON_SIZE, 1);
        micBtn.onTriggerUp.add(() => this.onMicTap());

        this.micLabelText = this.makeLabel(micObj, "Mic", 0, 0, 41, textMaterial, font, MIC_BUTTON_SIZE - 1, MIC_BUTTON_SIZE - 1);

        this.root.enabled = false;
    }

    /** Shows the popup at `worldPos`, matching `cameraRotation` exactly — see DeskCompanionTimerUI.show for why. */
    show(worldPos: vec3, cameraRotation: quat) {
        this.statusText.text = "Tap the mic to speak";
        this.transcriptText.text = "";
        this.micLabelText.text = "Mic";
        this.isListening = false;

        const t = this.root.getTransform();
        t.setWorldPosition(worldPos);
        t.setWorldRotation(cameraRotation);
        this.root.enabled = true;
    }

    hide() {
        if (this.isListening) {
            this.asrModule.stopTranscribing();
            this.isListening = false;
        }
        this.root.enabled = false;
    }

    private onMicTap() {
        if (global.deviceInfoSystem.isEditor()) {
            this.statusText.text = "Heard (simulated in Editor):";
            this.transcriptText.text = EDITOR_FALLBACK_TASK;
            this.onTaskStated.invoke(EDITOR_FALLBACK_TASK);
            return;
        }

        if (this.isListening) {
            this.stopListening();
        } else {
            this.startListening();
        }
    }

    private startListening() {
        this.isListening = true;
        this.micLabelText.text = "Listening...";
        this.statusText.text = "Listening... tap again to stop";
        this.transcriptText.text = "";

        const options = AsrModule.AsrTranscriptionOptions.create();
        options.silenceUntilTerminationMs = 1500;
        options.mode = AsrModule.AsrMode.HighAccuracy;

        options.onTranscriptionUpdateEvent.add((e: AsrModule.TranscriptionUpdateEvent) => {
            this.transcriptText.text = e.text;
            if (e.isFinal && e.text.trim().length > 0) {
                this.finishListening(e.text.trim());
            }
        });
        options.onTranscriptionErrorEvent.add((code: AsrModule.AsrStatusCode) => {
            this.isListening = false;
            this.micLabelText.text = "Mic";
            this.statusText.text = "ASR error: " + code;
        });

        this.asrModule.startTranscribing(options);
    }

    private stopListening() {
        if (!this.isListening) return;
        this.isListening = false;
        this.micLabelText.text = "Mic";

        this.asrModule.stopTranscribing().then(() => {
            const heard = this.transcriptText.text.trim();
            if (heard.length > 0) {
                this.finishListening(heard);
            } else {
                this.statusText.text = "Didn't catch that — tap to try again";
            }
        });
    }

    private finishListening(text: string) {
        this.isListening = false;
        this.micLabelText.text = "Mic";
        this.statusText.text = "Heard:";
        this.transcriptText.text = text;
        this.asrModule.stopTranscribing();
        this.onTaskStated.invoke(text);
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
        // `size` (or long ASR/dynamic text) wraps and, failing that, shrinks
        // — it can never visually spill outside its box.
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
