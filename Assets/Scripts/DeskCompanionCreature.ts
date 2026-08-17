// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Owns the desk companion's body, its idle animation, and the EXTENSION
// POINT for focus/distraction reactions.
//
// Body source: if `modelPrefab` is provided, that prefab (e.g. an imported
// FBX/OBJ with its own animation) is instantiated as the body and owns its
// own visuals/skeleton/clips untouched. If omitted, falls back to the
// original procedural gradient sphere (buildSphereVisual). Swapping in a
// custom model is a DeskCompanionMain Inspector assignment
// (creatureModelPrefab) — no code changes needed here or in DeskCompanionMain.
//
// EXTENSION POINT: call setFocusState(FocusState.Focused | .Distracted |
// .Neutral) from a future focus/distraction detector. Detecting whether the
// user is focused or distracted is OUT OF SCOPE for this build — this class
// only owns the reaction, and the reaction is deliberately gentle: every
// state maps to a soft color tint only (no shrink, no frown, no negative
// motion, no sound cue), so nothing here can read as "punishing" no matter
// what the future detector decides. Tinting is best-effort against whatever
// materials the body currently has (procedural sphere or custom model) — a
// custom model's shader may not expose a `baseColor` pass property, in which
// case tinting silently no-ops for that material rather than erroring.
//
// Plain class, not a @component — owned and driven by DeskCompanionMain so
// the scene stays a single authored root (spectacles-522-portable-design).

import { buildSphereVisual, createStandardMeshBuilder } from "./MeshPrimitives";
import { createFlatTexture } from "./FlatTexture";
import { getComponentsInDescendantsPortable } from "./SceneObjectHelpers";

export enum FocusState {
    Neutral = "Neutral",
    Focused = "Focused",
    Distracted = "Distracted",
}

// Gentle, non-punishing tints per state — soft hues only, no harsh/red color.
const STATE_COLOR: Record<FocusState, vec4> = {
    [FocusState.Neutral]: new vec4(0.62, 0.68, 0.78, 1),
    [FocusState.Focused]: new vec4(0.55, 0.82, 0.62, 1),
    [FocusState.Distracted]: new vec4(0.86, 0.72, 0.52, 1),
};

// Rim/fresnel-style highlight: a slightly-enlarged, back-faces-only copy of
// each mesh, additive-blended. With depth test on but depth write off, the
// enlarged shell is occluded by the real mesh everywhere except right at the
// silhouette edge (where the real mesh doesn't cover it) — the classic
// "inverted hull" trick for an edge/rim glow without needing a custom
// fresnel shader (this project stays on stock Unlit-preset materials only).
const RIM_SCALE = 1.08;
const RIM_COLOR_RGB = new vec3(1.0, 0.95, 0.55); // light yellow

// Blink animation: cycles through faceFrames (expected order: open -> ...
// -> closed -> ... -> open) over BLINK_FRAME_SECONDS per frame, then holds
// on frame 0 for a randomized interval before blinking again.
const BLINK_FRAME_SECONDS = 0.05;
const BLINK_INTERVAL_MIN_SECONDS = 2.5;
const BLINK_INTERVAL_MAX_SECONDS = 5.5;

// How quickly the creature turns to face the user (updateFacing) — higher is
// snappier. Framerate-independent exponential smoothing (1 - e^-rate*dt), so
// this reads the same on-device as in Preview regardless of frame time.
const FACE_TURN_LERP_RATE = 4;

/** Case-insensitive exact-name search through all descendants (BFS). Returns null if no match. */
function findDescendantByName(root: SceneObject, name: string): SceneObject | null {
    const target = name.toLowerCase();
    const queue: SceneObject[] = [root];
    while (queue.length > 0) {
        const obj = queue.shift() as SceneObject;
        if (obj !== root && obj.name.toLowerCase() === target) {
            return obj;
        }
        for (let i = 0; i < obj.getChildrenCount(); i++) {
            queue.push(obj.getChild(i));
        }
    }
    return null;
}

/** True if `obj` is `root` itself or nested anywhere underneath it. */
function isSameOrDescendantOf(obj: SceneObject, root: SceneObject): boolean {
    let cur: SceneObject | null = obj;
    while (cur) {
        if (cur === root) return true;
        cur = cur.getParent();
    }
    return false;
}

export class DeskCompanionCreature {
    private sceneObject: SceneObject;
    private tintedMaterials: Material[] = [];
    private rimMaterials: Material[] = [];
    private focusState: FocusState = FocusState.Neutral;
    private targetColor: vec4 = STATE_COLOR[FocusState.Neutral];
    private currentColor: vec4 = STATE_COLOR[FocusState.Neutral];
    private basePosition: vec3 = vec3.zero();
    private bobPhase: number = Math.random() * Math.PI * 2;
    /** Public — set every frame from an Inspector @input so brightness is live-tweakable in Preview with no code changes. 1.0 = base color, higher = brighter/more "blown out" bloom-like look. */
    fresnelBrightness: number = 1.5;

    private faceMaterial?: Material;
    private faceFrames: Texture[] = [];
    private timeSinceLastBlink: number = 0;
    private nextBlinkDelay: number = BLINK_INTERVAL_MIN_SECONDS;
    private isBlinking: boolean = false;
    private blinkElapsed: number = 0;

    // Smoothed yaw-only "look at the user" rotation — see updateFacing().
    private facingRotation: quat = quat.quatIdentity();
    // Which way the creature's own "face" child actually points, measured
    // from its real geometry/rotation (see the face-card block in the
    // constructor) rather than assumed — a fixed axis guess was
    // intermittently wrong depending on how a given creatureModelPrefab was
    // authored. Defaults to world -Z (matching the engine's own "-Z is
    // forward" convention) when there's no face mesh to measure from.
    private frontDirectionLocal: vec3 = vec3.back();
    // One-time correction so updateFacing() (which always computes a
    // quat.lookAt(targetDir, up) — empirically, quat.lookAt's `forward`
    // parameter maps to local +Z, not -Z; verified by measuring the actual
    // resulting rotation angle against a known target direction, since
    // trusting the engine's general "-Z is forward" convention for this
    // specific utility function's own parameter semantics turned out wrong
    // and was producing a body rotation off by a fixed ~180deg baked into
    // every facing update) can compensate for frontDirectionLocal actually
    // being some other direction — see updateFacing().
    private frontCorrection: quat = quat.quatIdentity();

    // Optional "book" prop modeled as part of the same creatureModelPrefab
    // (see the constructor) — hidden by default, shown only during a focus
    // session via setBookVisible(). Stays undefined (setBookVisible() is
    // then a no-op) when there's no child named "book".
    private bookObj?: SceneObject;
    private bookAnimPlayers: AnimationPlayer[] = [];

    constructor(
        owner: SceneObject,
        baseMaterial: Material,
        radiusCm: number,
        gradientTexture?: Texture,
        modelPrefab?: ObjectPrefab,
        faceFrames?: Texture[]
    ) {
        this.sceneObject = owner;

        if (modelPrefab) {
            modelPrefab.instantiate(owner);
        } else {
            buildSphereVisual(owner, baseMaterial, radiusCm);
        }

        // The "face" mesh (if present) gets its own texture-swapping
        // treatment below — exclude it from the gradient/rim treatment the
        // rest of the body gets, so its expression texture isn't overwritten
        // and doesn't get a glowing outline drawn over it.
        const faceObj = findDescendantByName(owner, "face");
        // A "book" prop (if the artist modeled it as part of the same
        // prefab rather than wiring DeskCompanionMain's separate
        // bookPencilPrefab input) should read as a normal prop, not part of
        // the creature's own body — exclude it and anything nested under it
        // (e.g. a separate pencil mesh) from the tint/rim-glow treatment too.
        const bookObj = findDescendantByName(owner, "book");
        const excludedRoots = [faceObj, bookObj].filter((o): o is SceneObject => !!o);

        if (bookObj) {
            this.bookObj = bookObj;
            this.bookAnimPlayers = getComponentsInDescendantsPortable(bookObj, "Component.AnimationPlayer");
            // Hidden until a focus session actually starts — see setBookVisible().
            bookObj.enabled = false;
        }

        // Same gradient-textured base material for either body source — a
        // custom model prefab gets the identical pink-to-blue look the
        // procedural sphere has, replacing whatever material(s) it shipped
        // with, rather than tinting on top of them. Cloned per-mesh so
        // focus-state tinting never mutates a shared asset.
        const allVisuals = getComponentsInDescendantsPortable(owner, "Component.RenderMeshVisual");
        const visuals = allVisuals.filter((v) =>
            !excludedRoots.some((root) => isSameOrDescendantOf(v.getSceneObject(), root))
        );
        for (const visual of visuals) {
            const mat = baseMaterial.clone();
            mat.mainPass.blendMode = BlendMode.Disabled;
            mat.mainPass.depthTest = true;
            mat.mainPass.depthWrite = true;
            if (gradientTexture) {
                mat.mainPass.baseTex = gradientTexture;
            }
            visual.mainMaterial = mat;
            this.tintedMaterials.push(mat);
        }
        this.applyColor(this.currentColor);

        // Rim highlight shell — one per mesh, parented to that mesh's own
        // SceneObject so it inherits the exact same world transform, then
        // scaled up slightly around that same pivot.
        const flatTex = createFlatTexture(255, 255, 255, 255);
        for (const visual of visuals) {
            const meshOwner = visual.getSceneObject();
            const rimObj = global.scene.createSceneObject("RimGlow");
            rimObj.setParent(meshOwner);
            rimObj.getTransform().setLocalPosition(vec3.zero());
            rimObj.getTransform().setLocalRotation(quat.quatIdentity());
            rimObj.getTransform().setLocalScale(new vec3(RIM_SCALE, RIM_SCALE, RIM_SCALE));

            const rimMat = baseMaterial.clone();
            rimMat.mainPass.blendMode = BlendMode.Add;
            rimMat.mainPass.depthTest = true;
            rimMat.mainPass.depthWrite = false;
            rimMat.mainPass.cullMode = CullMode.Front; // only back faces render — see RIM_SCALE comment above
            rimMat.mainPass.baseTex = flatTex;
            rimMat.mainPass.baseColor = new vec4(RIM_COLOR_RGB.x, RIM_COLOR_RGB.y, RIM_COLOR_RGB.z, 1);

            const rimVisual = rimObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
            rimVisual.mesh = visual.mesh;
            rimVisual.mainMaterial = rimMat;
            this.rimMaterials.push(rimMat);
        }

        // Face expression: swap the "face" mesh's baseTex between frames.
        // faceFrames[0] is the resting/eyes-open look, held between blinks.
        if (faceObj && faceFrames && faceFrames.length > 0) {
            const faceVisual = faceObj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
            if (faceVisual) {
                // The imported mesh's own UV unwrap (inherited from whatever
                // primitive it was sculpted from in the DCC tool) only
                // exposes a thin sliver of V range — verified empirically by
                // swapping in a full-bleed test-pattern texture, which came
                // back as a narrow horizontal band rather than the whole
                // image. That sliver lands on blank space in the actual eye
                // frames, so the face rendered invisible even though baseTex
                // was being applied correctly. Replacing the geometry with a
                // plain flat card (proper 0-1 UVs, sized to the original
                // mesh's own bounds so it still sits in the same place) sidesteps
                // the broken unwrap entirely instead of depending on it.
                const originalMesh = faceVisual.mesh;
                if (originalMesh) {
                    const min = originalMesh.aabbMin;
                    const max = originalMesh.aabbMax;
                    const center = new vec3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
                    const extent = [
                        Math.max(0.04, max.x - min.x),
                        Math.max(0.04, max.y - min.y),
                        Math.max(0.04, max.z - min.z),
                    ];

                    // Figure out, from this node's own baked import rotation
                    // (e.g. a Blender Z-up -> Lens Studio Y-up conversion —
                    // confirmed on this model as a uniform -90 deg-about-X
                    // rotation shared by every body mesh), which raw
                    // mesh-local axis ends up pointing along the node's own
                    // forward/depth direction, and which of the remaining
                    // two reads as screen-horizontal vs. screen-vertical
                    // once rotated. A single flat quad with UVs assigned
                    // directly from that (rather than reusing addBox's
                    // fixed per-face UV convention, which — verified
                    // empirically — reads horizontal/vertical transposed on
                    // the dominant faces here) keeps the face texture
                    // right-side-up and camera-facing regardless of which
                    // axis convention a given creatureModelPrefab's export
                    // used, so swapping in a different model still works
                    // with no code change.
                    const localRot = faceObj.getTransform().getLocalRotation();
                    const rawAxis = [vec3.right(), vec3.up(), new vec3(0, 0, 1)];
                    const mapped = rawAxis.map((a) => localRot.multiplyVec3(a));

                    let normalAxis = 0;
                    for (let i = 1; i < 3; i++) {
                        if (Math.abs(mapped[i].z) > Math.abs(mapped[normalAxis].z)) normalAxis = i;
                    }
                    const remaining = [0, 1, 2].filter((i) => i !== normalAxis);
                    let uAxis = remaining[0], vAxis = remaining[1];
                    if (Math.abs(mapped[remaining[1]].x) > Math.abs(mapped[remaining[0]].x)) {
                        uAxis = remaining[1]; vAxis = remaining[0];
                    }

                    const uSign = mapped[uAxis].x >= 0 ? 1 : -1;
                    const vSign = mapped[vAxis].y >= 0 ? 1 : -1;
                    const uDir = rawAxis[uAxis].uniformScale(uSign * extent[uAxis] / 2);
                    const vDir = rawAxis[vAxis].uniformScale(vSign * extent[vAxis] / 2);
                    const normalDir = rawAxis[normalAxis];

                    // Record which world direction the face actually points
                    // (in the creature's own un-rotated rest frame) so
                    // updateFacing() can turn the whole body to genuinely
                    // face the player instead of assuming a fixed axis —
                    // see frontDirectionLocal/frontCorrection above.
                    const restFrontDir = new vec3(mapped[normalAxis].x, 0, mapped[normalAxis].z);
                    if (restFrontDir.lengthSquared > 0.0001) {
                        this.frontDirectionLocal = restFrontDir.normalize();
                        // Aligns frontDirectionLocal to vec3.forward() (+Z),
                        // NOT vec3.back() — see the frontCorrection field
                        // comment for why: quat.lookAt's `forward` parameter
                        // empirically maps to local +Z. For this model,
                        // frontDirectionLocal measures out to -Z, exactly
                        // opposite +Z, which is the one case
                        // quat.rotationFromTo can't handle (ill-defined
                        // rotation axis for exactly-opposite vectors — the
                        // same bug that made the whole creature flip
                        // upside-down rather than turn when it showed up in
                        // updateFacing() directly), so that case is
                        // special-cased to a predictable 180deg yaw instead.
                        const dotFwd = this.frontDirectionLocal.dot(vec3.forward());
                        this.frontCorrection = dotFwd < -0.999
                            ? quat.angleAxis(Math.PI, vec3.up())
                            : quat.rotationFromTo(this.frontDirectionLocal, vec3.forward());
                    }

                    const p00 = center.sub(uDir).sub(vDir);
                    const p10 = center.add(uDir).sub(vDir);
                    const p11 = center.add(uDir).add(vDir);
                    const p01 = center.sub(uDir).add(vDir);

                    const cardBuilder = createStandardMeshBuilder();
                    cardBuilder.appendVerticesInterleaved([
                        p00.x, p00.y, p00.z, normalDir.x, normalDir.y, normalDir.z, 1, 1, 1, 1, 0, 0,
                        p10.x, p10.y, p10.z, normalDir.x, normalDir.y, normalDir.z, 1, 1, 1, 1, 1, 0,
                        p11.x, p11.y, p11.z, normalDir.x, normalDir.y, normalDir.z, 1, 1, 1, 1, 1, 1,
                        p01.x, p01.y, p01.z, normalDir.x, normalDir.y, normalDir.z, 1, 1, 1, 1, 0, 1,
                    ]);
                    // Both winding orders, not just one + `twoSided` — the
                    // translucent blend-mode shader path this material needs
                    // (see below) doesn't reliably honor `twoSided`/cullMode
                    // the way the opaque path does (verified empirically:
                    // identical config rendered fine opaque, invisible once
                    // switched to an alpha blend mode). Emitting the reverse
                    // winding too guarantees a front-facing triangle exists
                    // for whichever side the renderer treats as "front".
                    cardBuilder.appendIndices([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
                    faceVisual.mesh = cardBuilder.getMesh();
                    cardBuilder.updateMesh();
                }

                const mat = (faceVisual.mainMaterial ? faceVisual.mainMaterial.clone() : baseMaterial.clone());
                // clone() resets blendMode/depthTest/depthWrite/baseColor to
                // broken defaults on 5.15 (see baseMaterial's Inspector hint)
                // — every other clone in this file re-sets them immediately;
                // this one previously didn't, which was silently rendering
                // the face invisible/mis-blended despite baseTex being correct.
                // eye1-5.png are real RGBA PNGs (verified via their PNG
                // header — color type 6) with the ink on a transparent
                // background, so the material needs to actually blend on
                // alpha instead of ignoring it — Disabled mode draws the
                // texture's RGB straight through regardless of alpha, which
                // is what was showing the white background as opaque.
                // BlendMode.Normal rendered fully invisible on this preset
                // (verified) — PremultipliedAlphaAuto is the alpha-blend
                // mode already proven working elsewhere in this project (see
                // the placement ghost preview material).
                mat.mainPass.blendMode = BlendMode.PremultipliedAlphaAuto;
                // depthTest MUST stay false here, unlike every opaque clone
                // elsewhere in this file — verified empirically: depthTest
                // true made this specific translucent shader path render
                // fully invisible (matches the source DeskCompanionBaseMaterial
                // asset's own authored depthTest:false/depthWrite:false, which
                // is what finally worked). The face card sits flush on the
                // head with nothing else meant to occlude it, so skipping the
                // depth test has no visible downside here.
                mat.mainPass.depthTest = false;
                mat.mainPass.depthWrite = false;
                // The replacement card's "front" (correctly-oriented UV) face
                // doesn't necessarily land toward the camera — it inherits
                // whichever local axis the original FBX mesh happened to use.
                // Render both sides so the textured face is visible from the
                // direction the user actually views it from, instead of
                // guessing/hardcoding a winding that might be wrong per-model.
                mat.mainPass.twoSided = true;
                mat.mainPass.baseColor = new vec4(1, 1, 1, 1);
                mat.mainPass.baseTex = faceFrames[0];
                faceVisual.mainMaterial = mat;
                this.faceMaterial = mat;
                this.faceFrames = faceFrames;
                this.rollNextBlinkDelay();
            }
        }
    }

    setEnabled(enabled: boolean) {
        this.sceneObject.enabled = enabled;
    }

    isEnabled(): boolean {
        return this.sceneObject.enabled;
    }

    /**
     * Shows/hides the "book" prop modeled inside creatureModelPrefab (see
     * the constructor) — call with true when a focus countdown starts and
     * false when it ends. No-op if no child named "book" was found.
     * Restarts/stops any AnimationPlayer found under it on the same edges.
     */
    setBookVisible(visible: boolean) {
        if (!this.bookObj) return;
        this.bookObj.enabled = visible;
        for (const player of this.bookAnimPlayers) {
            if (visible) {
                player.playAll();
            } else {
                player.stopAll();
            }
        }
    }

    /** Places the creature so its base rests on `surfacePos` (local origin = bottom pole, see buildSphere). */
    placeAt(surfacePos: vec3) {
        this.basePosition = surfacePos;
        this.sceneObject.getTransform().setWorldPosition(surfacePos);
    }

    getPosition(): vec3 {
        return this.sceneObject.getTransform().getWorldPosition();
    }

    /**
     * World-space Y of the highest point across all body meshes — use this
     * (plus a small margin) to position UI above the creature, instead of a
     * fixed offset. Works for the procedural sphere or any custom model at
     * any scale/pivot, since it reads the actual rendered geometry rather
     * than assuming a size.
     */
    getTopWorldY(): number {
        let maxY = this.sceneObject.getTransform().getWorldPosition().y;
        const visuals = getComponentsInDescendantsPortable(this.sceneObject, "Component.RenderMeshVisual");
        for (const visual of visuals) {
            const mesh = visual.mesh;
            if (!mesh) continue;
            const worldTransform = visual.getSceneObject().getTransform().getWorldTransform();
            const min = mesh.aabbMin;
            const max = mesh.aabbMax;
            for (let i = 0; i < 8; i++) {
                const corner = new vec3(
                    (i & 1) ? max.x : min.x,
                    (i & 2) ? max.y : min.y,
                    (i & 4) ? max.z : min.z
                );
                const worldCorner = worldTransform.multiplyPoint(corner);
                if (worldCorner.y > maxY) {
                    maxY = worldCorner.y;
                }
            }
        }
        return maxY;
    }

    /**
     * EXTENSION POINT — call this from a future focus/distraction detector.
     * Never punishing: only a soft color shift, lerped in over time (never an
     * instant snap) so even a "Distracted" read stays calm and non-alarming.
     */
    setFocusState(state: FocusState) {
        this.focusState = state;
        this.targetColor = STATE_COLOR[state];
    }

    getFocusState(): FocusState {
        return this.focusState;
    }

    /** Idle breathing bob + gentle color lerp toward the current focus state. Call every frame. */
    update(deltaTime: number) {
        if (!this.sceneObject.enabled) return;

        this.bobPhase += deltaTime * 1.6;
        const bobY = Math.sin(this.bobPhase) * 0.4; // cm — small, calm breathing motion
        this.sceneObject.getTransform().setWorldPosition(
            new vec3(this.basePosition.x, this.basePosition.y + bobY, this.basePosition.z)
        );

        const lerpT = Math.min(1, deltaTime * 2.0);
        this.currentColor = vec4.lerp(this.currentColor, this.targetColor, lerpT);
        this.applyColor(this.currentColor);

        // Read live every frame so dragging the Inspector slider during
        // Preview updates the glow immediately — no recompile needed.
        const b = Math.max(0, this.fresnelBrightness);
        for (const mat of this.rimMaterials) {
            mat.mainPass.baseColor = new vec4(RIM_COLOR_RGB.x * b, RIM_COLOR_RGB.y * b, RIM_COLOR_RGB.z * b, 1);
        }

        this.updateBlink(deltaTime);
    }

    /**
     * Smoothly turns the creature (yaw only) to face `cameraWorldPos` —
     * call every frame while this behavior should be active; simply stop
     * calling it to freeze the creature at its current facing (e.g. once a
     * focus session starts and it should hold still / face its desk props
     * instead of the user). Exponential smoothing rather than a per-frame
     * lerp toward a fixed target keeps the turn speed frame-rate independent
     * and gives it a lively, slightly-lagging "catching up" feel rather than
     * a mechanical snap.
     */
    updateFacing(cameraWorldPos: vec3, deltaTime: number) {
        if (!this.sceneObject.enabled) return;

        const pos = this.sceneObject.getTransform().getWorldPosition();
        const toCamera = new vec3(cameraWorldPos.x - pos.x, 0, cameraWorldPos.z - pos.z);
        if (toCamera.lengthSquared < 0.0001) return; // camera directly overhead — hold last facing

        const targetDir = toCamera.normalize();
        // quat.lookAt, not rotationFromTo(frontDirectionLocal, targetDir)
        // directly — that computes a shortest-arc rotation between two
        // vectors, which is ill-defined (arbitrary/unstable rotation axis)
        // whenever targetDir sits close to exactly opposite the model's
        // resting front — a very common case (camera roughly in front),
        // and it was flipping the model upside-down there instead of
        // yawing it. lookAt builds a full orthonormal basis instead, so it
        // stays well-defined for any horizontal direction. bodyRotation
        // maps local +Z (quat.lookAt's own `forward` convention — verified
        // empirically, see frontCorrection's comment) to targetDir;
        // frontCorrection (measured once from the actual face geometry,
        // see the constructor) compensates for the real front direction
        // being something else, so the actual face — not just an assumed
        // axis — ends up pointing at the player.
        const bodyRotation = quat.lookAt(targetDir, vec3.up());
        const targetRotation = bodyRotation.multiply(this.frontCorrection);
        const t = 1 - Math.exp(-FACE_TURN_LERP_RATE * deltaTime);
        this.facingRotation = quat.slerp(this.facingRotation, targetRotation, t);
        this.sceneObject.getTransform().setWorldRotation(this.facingRotation);
    }

    private rollNextBlinkDelay() {
        this.nextBlinkDelay = BLINK_INTERVAL_MIN_SECONDS
            + Math.random() * (BLINK_INTERVAL_MAX_SECONDS - BLINK_INTERVAL_MIN_SECONDS);
    }

    private updateBlink(deltaTime: number) {
        if (!this.faceMaterial || this.faceFrames.length === 0) return;

        if (!this.isBlinking) {
            this.timeSinceLastBlink += deltaTime;
            if (this.timeSinceLastBlink >= this.nextBlinkDelay) {
                this.isBlinking = true;
                this.blinkElapsed = 0;
            }
            return;
        }

        this.blinkElapsed += deltaTime;
        const frameIndex = Math.min(
            this.faceFrames.length - 1,
            Math.floor(this.blinkElapsed / BLINK_FRAME_SECONDS)
        );
        this.faceMaterial.mainPass.baseTex = this.faceFrames[frameIndex];

        const blinkTotalSeconds = this.faceFrames.length * BLINK_FRAME_SECONDS;
        if (this.blinkElapsed >= blinkTotalSeconds) {
            this.isBlinking = false;
            this.timeSinceLastBlink = 0;
            this.faceMaterial.mainPass.baseTex = this.faceFrames[0];
            this.rollNextBlinkDelay();
        }
    }

    private applyColor(color: vec4) {
        for (const mat of this.tintedMaterials) {
            try {
                mat.mainPass.baseColor = color;
            } catch (e) {
                // Custom model shader has no baseColor pass property — skip tinting for it.
            }
        }
    }
}
