// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Runtime-built calibration popup: an instruction label ("look at your
// workspace"), a ring of pip segments that fill clockwise as a loading
// indicator, and a live seconds-remaining label. Built entirely from
// MeshBuilder geometry + Text3D — no SpectaclesUIKit, no custom shaders —
// same portable pattern as DeskCompanionTimerUI (see
// spectacles-522-portable-design skill).
//
// Plain class, not a @component — owned and driven by DeskCompanionMain,
// which also owns the calibration timer and gaze-sampling (this class only
// renders progress it's told about via setProgress()).

import { buildBoxVisual } from "./MeshPrimitives";
import { setText3DColor } from "./Text3DHelpers";

const PIP_COUNT = 24;
const RING_RADIUS = 5;
const PIP_SIZE = 0.7;
const PIP_DEPTH = 0.6;
// See DeskCompanionTimerUI's FRONT_Z comment — same reasoning: the panel's
// rotation matches the camera's rotation exactly, so local +Z faces the
// viewer; a small forward offset keeps labels/pips off the z=0 plane.
const FRONT_Z = 0.6;

const DIM_COLOR = new vec4(0.3, 0.32, 0.36, 1);
const LIT_COLOR = new vec4(0.55, 0.78, 0.92, 1); // calm blue — consistent with the creature's gentle-tint palette

export class DeskCompanionCalibrationUI {
    private root: SceneObject;
    private secondsText: Text3D;
    private pipMaterials: Material[] = [];

    constructor(owner: SceneObject, baseMaterial: Material, textMaterial: Material, font: Font, uiFlatTex: Texture) {
        this.root = owner;

        this.makeLabel(this.root, "Look at your workspace to calibrate", 0, 9, 36, textMaterial, font);
        // Centered in the middle of the pip ring (see RING_RADIUS) — kept at
        // its own explicitly-tuned size (not part of the general 1.5x pass
        // applied to every other label) so the ring's live countdown stays
        // exactly as large as previously dialed in.
        this.secondsText = this.makeLabel(this.root, "", 0, 0, 240, textMaterial, font);

        const pipBase = baseMaterial.clone();
        pipBase.mainPass.blendMode = BlendMode.Disabled;
        pipBase.mainPass.depthTest = true;
        pipBase.mainPass.depthWrite = true;
        pipBase.mainPass.twoSided = true;
        // baseMaterial clones default baseTex to the engine's placeholder
        // "missing image" icon — replace it so pips show flat color instead
        // of that glyph (see FlatTexture.ts). Every pip clones pipBase, so
        // this propagates to all of them.
        pipBase.mainPass.baseTex = uiFlatTex;

        for (let i = 0; i < PIP_COUNT; i++) {
            const theta = (i / PIP_COUNT) * Math.PI * 2;
            const x = Math.sin(theta) * RING_RADIUS;
            const y = Math.cos(theta) * RING_RADIUS;

            const obj = global.scene.createSceneObject(`CalibPip_${i}`);
            obj.setParent(this.root);
            obj.getTransform().setLocalPosition(new vec3(x, y, FRONT_Z));

            const mat = pipBase.clone();
            mat.mainPass.baseColor = DIM_COLOR;
            buildBoxVisual(obj, mat, PIP_SIZE / 2, PIP_SIZE / 2, PIP_DEPTH / 2, [1, 1, 1, 1]);
            this.pipMaterials.push(mat);
        }

        this.root.enabled = false;
    }

    /** Shows the popup matching `cameraRotation` exactly — see DeskCompanionTimerUI.show for why. */
    show(worldPos: vec3, cameraRotation: quat) {
        for (const mat of this.pipMaterials) {
            mat.mainPass.baseColor = DIM_COLOR;
        }
        this.secondsText.text = "";

        const t = this.root.getTransform();
        t.setWorldPosition(worldPos);
        t.setWorldRotation(cameraRotation);
        this.root.enabled = true;
    }

    hide() {
        this.root.enabled = false;
    }

    /** Repositions the already-shown panel to match `worldPos`/`cameraRotation` — call every frame for a HUD-locked panel. */
    setWorldPose(worldPos: vec3, cameraRotation: quat) {
        const t = this.root.getTransform();
        t.setWorldPosition(worldPos);
        t.setWorldRotation(cameraRotation);
    }

    /** `progress01` in [0,1] lights that fraction of the ring clockwise; `secondsRemaining` drives the live countdown label. */
    setProgress(progress01: number, secondsRemaining: number) {
        const lit = Math.floor(PIP_COUNT * Math.min(1, Math.max(0, progress01)));
        for (let i = 0; i < PIP_COUNT; i++) {
            this.pipMaterials[i].mainPass.baseColor = i < lit ? LIT_COLOR : DIM_COLOR;
        }
        this.secondsText.text = `${Math.ceil(Math.max(0, secondsRemaining))}s`;
    }

    private makeLabel(
        parent: SceneObject, text: string, x: number, y: number, size: number,
        textMaterial: Material, font: Font
    ): Text3D {
        const obj = global.scene.createSceneObject("Label");
        obj.setParent(parent);
        obj.getTransform().setLocalPosition(new vec3(x, y, FRONT_Z));

        const t3d = obj.createComponent("Component.Text3D") as Text3D;
        t3d.text = text;
        t3d.font = font;
        t3d.size = size;

        const mat = textMaterial.clone();
        mat.mainPass.twoSided = true;
        setText3DColor(mat, new vec4(0.95, 0.95, 0.97, 1));
        t3d.mainMaterial = mat;
        return t3d;
    }
}
