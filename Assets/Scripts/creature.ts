// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DeskCompanionMain — root orchestrator for the desk-companion experience.
//
// NOTE ON FILENAME: this file is still named `creature.ts` because it is the
// original project stub and the scene's ScriptComponent already references
// it by path (`@asset:creature.ts`) — renaming would need an extra asset
// rename + rewire pass. The exported class is `DeskCompanionMain`; treat
// this file as the app's single root controller, not "the creature".
//
// Portability (spectacles-522-portable-design): this is the ONE authored
// SceneObject + script the scene needs. Every other object (creature body,
// timer popup, buttons, countdown text) is created here at runtime via
// MeshBuilder + Text3D + cloned ImageMaterialPreset/Text3DMaterialPreset —
// no SpectaclesUIKit, no custom shaders, only the 5.15-safe SIK core
// (HandInputData, WorldCameraFinderProvider, runtime-created Interactable
// via TapInteraction) and the WorldQueryModule hit-test API.
//
// Flow: PlacingSurface (pinch to place on a detected flat surface) ->
// Calibrating (10s hold — user looks at their workspace while we average
// the camera's forward vector into a baseline gaze direction) ->
// AskingTask (voice: "what do you want to achieve today?") ->
// BreakingDown (one OpenAI call via RemoteServiceGateway splits the stated
// task into 3 short sub-steps — see TaskBreakdownService.ts) ->
// MissionBoard (3 subtask cards; tap one to start it) ->
// SettingTimer (-/+ stepper 5-25 min, step 5, Confirm button) ->
// CountingDown (chosen duration) -> back to MissionBoard with that card
// ticked -> ... -> Complete once all 3 are done.
//
// DISTRACTION DETECTION: during CountingDown only (the actual focus
// session — gaze moving around during the mission board / timer stepper is
// normal UI interaction, not distraction), tickDistraction() compares the
// live camera-forward vector against the calibrated `baselineForward` every
// frame. A deviation must sustain past a threshold (not an instant flip) in
// either direction before calling creature.setFocusState(...), so a quick
// glance away doesn't flicker the tint.

import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import { DeskCompanionCreature, FocusState } from "./DeskCompanionCreature";
import { DeskCompanionCalibrationUI } from "./DeskCompanionCalibrationUI";
import { DeskCompanionDialogueUI, DialogueStep } from "./DeskCompanionDialogueUI";
import { DeskCompanionAskingTaskUI } from "./DeskCompanionAskingTaskUI";
import { DeskCompanionMissionBoardUI } from "./DeskCompanionMissionBoardUI";
import { DeskCompanionTimerUI } from "./DeskCompanionTimerUI";
import { DeskCompanionDistractionHintUI } from "./DeskCompanionDistractionHintUI";
import { breakDownTask } from "./TaskBreakdownService";
import { setText3DColor } from "./Text3DHelpers";
import { TapInteraction } from "./TapInteraction";
import { buildBoxVisual, buildSphereVisual } from "./MeshPrimitives";
import { createFlatTexture } from "./FlatTexture";
import { PhoneDetectionServiceOnDevice } from "./PhoneDetectionServiceOnDevice";
import { getComponentsInDescendantsPortable } from "./SceneObjectHelpers";

enum CompanionPhase {
    PlacingSurface = "PlacingSurface",
    IntroDialogue = "IntroDialogue",
    Calibrating = "Calibrating",
    AskingTask = "AskingTask",
    BreakingDown = "BreakingDown",
    MissionBoard = "MissionBoard",
    SettingTimer = "SettingTimer",
    CountingDown = "CountingDown",
    Complete = "Complete",
}

// Scripted intro dialogue, played once right after placement, before the
// real 10s gaze-hold calibration begins.
const INTRO_DIALOGUE_STEPS: DialogueStep[] = [
    { lines: ["Let's get to work!"], buttonLabel: "Next" },
    { lines: ["Where do you want to work on?", "Are you ready?"], buttonLabel: "I'm ready" },
    { lines: ["Could you look at there for 10 seconds for me?"], buttonLabel: "Okay" },
];

interface MissionSubtask {
    text: string;
    done: boolean;
}

@component
export class DeskCompanionMain extends BaseScriptComponent {

    @input
    @hint("Base material clone source (ImageMaterialPreset) — used for the creature body and all UI panel/button geometry. Every clone sets its own baseColor/blendMode/depthTest/depthWrite in code (5.15 clone() resets Inspector values).")
    baseMaterial!: Material;

    @input
    @hint("Material clone source for Text3D labels (Text3DMaterialPreset).")
    textMaterial!: Material;

    @input
    @hint("Pink-to-blue gradient texture applied to the creature body's baseTex (still tinted per focus state via baseColor multiply). Ignored when creatureModelPrefab is set.")
    creatureGradientTexture!: Texture;

    @input
    @allowUndefined
    @hint("Optional creature body override — an imported FBX/OBJ prefab (with its own animation, if any). Leave empty to use the procedural gradient sphere. Drop your own model in here later; no code changes needed.")
    creatureModelPrefab?: ObjectPrefab;

    @input
    @hint("Brightness of the light-yellow fresnel/rim glow around the creature's silhouette. 1.0 = base color, higher = brighter/more blown-out. Live-tweakable — drag this during Preview to see the change immediately, no recompile needed.")
    fresnelBrightness: number = 1.5;

    @input
    @allowUndefined
    @hint("Face expression sequence, frame 1 of 5 — the resting/eyes-open look (held between blinks). Applied to the child SceneObject named 'face' inside creatureModelPrefab. Leave all 5 empty to skip the face feature entirely.")
    faceFrame0?: Texture;

    @input
    @allowUndefined
    @hint("Face expression sequence, frame 2 of 5 (blink, partway closing).")
    faceFrame1?: Texture;

    @input
    @allowUndefined
    @hint("Face expression sequence, frame 3 of 5 (blink, eyes closed).")
    faceFrame2?: Texture;

    @input
    @allowUndefined
    @hint("Face expression sequence, frame 4 of 5 (blink, partway opening).")
    faceFrame3?: Texture;

    @input
    @allowUndefined
    @hint("Face expression sequence, frame 5 of 5 — back to eyes-open (typically identical or near-identical to frame 1).")
    faceFrame4?: Texture;

    @input
    @allowUndefined
    @hint("Optional desk prop shown only during the focus countdown (e.g. a book + pencil model/animation) — instantiated hidden at startup, enabled when a timer is confirmed and disabled again when that countdown ends. If the prop has an AnimationPlayer component, playAll()/stopAll() fires on the same show/hide edges. Leave empty to skip the feature entirely; drop a prefab in here later, no code changes needed.")
    bookPencilPrefab?: ObjectPrefab;

    @input
    @allowUndefined
    @hint("Creature-voice chirp variant 1/3 — a short synthesized murmur/blip, retriggered rapidly (randomized between the 3 variants) in sync with the intro dialogue's typewriter text reveal. Leave all 3 empty for silent typing.")
    dialogueChirp0?: AudioTrackAsset;

    @input
    @allowUndefined
    @hint("Creature-voice chirp variant 2/3.")
    dialogueChirp1?: AudioTrackAsset;

    @input
    @allowUndefined
    @hint("Creature-voice chirp variant 3/3.")
    dialogueChirp2?: AudioTrackAsset;

    @input
    @hint("Font asset used by every Text3D label in the popup and the countdown display.")
    uiFont!: Font;

    @input
    @hint("Wireframe-render the placement/UI hit colliders — debug only, off by default.")
    debugColliders: boolean = false;

    @input
    @hint("One-shot sound played when the creature notices distraction (gaze deviates from the calibrated baseline for DISTRACTION_SUSTAIN_SECONDS). Still a placeholder — swap for a warmer, custom-generated cue once /build-sfx can run (needs Node.js).")
    distractionSfx!: AudioTrackAsset;

    @input
    @allowUndefined
    @hint("One-shot celebratory sound played once, when every mission subtask is done (CompanionPhase.Complete). Gentle, never punishing — this is a reward cue, not a nag. Leave empty to skip the feature.")
    sessionCompleteSfx?: AudioTrackAsset;

    @input
    @hint("Text shown (with typewriter effect + voice) when distraction is triggered by gaze deviating from the calibrated baseline. Edit freely — this is the only place this wording lives.")
    distractionMessage: string = "Still with me?";

    @input
    @hint("Text shown instead of distractionMessage when distraction is specifically triggered by the phone-presence classifier (phoneMlComponent) being sustained for DISTRACTION_SUSTAIN_SECONDS. Edit freely.")
    phoneDistractionMessage: string = "Distracted by phone?";

    @input
    @allowUndefined
    @hint("MLComponent running the on-device phone-presence classifier (PhoneDetectionML SceneObject). Leave empty to disable phone detection — gaze-based distraction still works on its own.")
    phoneMlComponent?: MLComponent;

    @input
    @hint("Index into the classifier's 2-class softmax output ('probabilities': [class0, class1]) that corresponds to 'phone present'. Verify empirically — training class order isn't guaranteed.")
    phoneClassIndex: number = 1;

    @input
    @hint("Minimum softmax probability at phoneClassIndex to count as 'phone visible'. Originally 0.85, calibrated against one static hand-with-no-phone test image (~0.66) vs. a genuine phone photo (~0.9999). Raised to 0.93 after on-device testing showed frequent false positives — a real desk scene (lighting, clutter, hand poses) apparently reads higher than that single test image did. Re-tune from live readings if it's still over- or under-triggering.")
    phoneDetectionThreshold: number = 0.93;

    // ---- Tunables ----
    private readonly CREATURE_RADIUS_CM = 4;
    // Vertical gap between the creature's actual top (measured from its
    // real mesh bounds, not this constant — see DeskCompanionCreature
    // .getTopWorldY()) and the popup panels floated above it. Using real
    // bounds means this keeps working no matter what size/pivot a custom
    // creatureModelPrefab has, instead of assuming the procedural sphere's
    // fixed radius.
    // Was 8 — sized back when the creature was much taller, giving natural
    // extra clearance even at this small a fixed offset. Now that the
    // creature is much smaller (~15cm), the tallest popup's own downward
    // reach below its anchor (DeskCompanionAskingTaskUI's mic button bottom
    // edge sits ~12.5cm below the panel's own center) needs real headroom
    // added here, or it visually dips into the now-much-shorter creature.
    private readonly PANEL_ABOVE_CREATURE_CM = 16;
    // The countdown display is 10x the size of every other label (see
    // countdownText.size below), so it needs a little more clearance above
    // the creature than PANEL_ABOVE_CREATURE_CM to avoid visually touching
    // it — but only just enough, not a big floating gap.
    private readonly COUNTDOWN_ABOVE_CREATURE_CM = 20;
    // Default side offset for the optional book/pencil prop, placed once at
    // placement time — a reasonable starting point until the real asset
    // exists and its own size/pivot can be tuned against.
    private readonly BOOK_PENCIL_SIDE_OFFSET_CM = 10;
    private readonly MIN_MINUTES = 5;
    private readonly MAX_MINUTES = 25;
    private readonly DEFAULT_MINUTES = 5;
    private readonly MINUTE_STEP = 5;
    // How long the user must hold their gaze on the workspace to establish
    // the baseline forward direction a future distraction detector compares
    // against.
    private readonly CALIBRATION_DURATION_SECONDS = 10;
    // WorldQueryHitTestResult.normal.y must exceed this to count as "flat
    // enough" to place on (rejects walls / steep surfaces).
    private readonly SURFACE_FLATNESS_MIN_Y = 0.7;
    private readonly PLACEMENT_RAY_LENGTH_CM = 200;
    // Distraction detection (CountingDown only) — how far the camera-forward
    // vector may deviate from the calibrated baseline before it counts as
    // "looking away", and how long that deviation (or a return to baseline)
    // must sustain before flipping the creature's focus tint. Sustaining
    // avoids flicker on quick glances. 22.5deg = a 45deg-wide allowed cone
    // (-22.5 to +22.5) around the calibrated baseline direction.
    private readonly DISTRACTION_ANGLE_DEG = 22.5;
    private readonly DISTRACTION_SUSTAIN_SECONDS = 3;
    private readonly REFOCUS_SUSTAIN_SECONDS = 1.5;
    // Floor between one distraction alert (sound + hint) and the next, even
    // if the sustain windows above would otherwise allow an immediate
    // re-trigger — protects against a noisy/lingering phone-detection signal
    // re-firing the alert every few seconds while gaze itself is fine.
    // Note: this throttles the SOUND/HINT only — the creature's tint
    // (setFocusState) still flips immediately every time the sustain window
    // is crossed, unthrottled, so gaze-based distraction is still fully live
    // even while this cooldown is active.
    private readonly MIN_ALERT_INTERVAL_SECONDS = 7;

    private worldQueryModule: WorldQueryModule = require("LensStudio:WorldQueryModule");
    private hitTestSession!: HitTestSession;

    // ImageMaterialPreset clones default baseTex to the engine's
    // placeholder "missing image" icon (see FlatTexture.ts) — every UI
    // panel/button/pip and the placement preview override baseTex with
    // this instead so they render flat color, not that glyph.
    private uiFlatTex!: Texture;

    private phase: CompanionPhase = CompanionPhase.PlacingSurface;
    private creature!: DeskCompanionCreature;
    private calibrationUI!: DeskCompanionCalibrationUI;
    private dialogueUI!: DeskCompanionDialogueUI;
    private askingTaskUI!: DeskCompanionAskingTaskUI;
    private missionBoardUI!: DeskCompanionMissionBoardUI;
    private timerUI!: DeskCompanionTimerUI;

    // Optional focus-session desk prop (book + pencil) — see bookPencilPrefab
    // input. Both stay undefined when the input is empty, and every use site
    // below is guarded accordingly.
    private bookPencilObj?: SceneObject;
    private bookPencilAnimPlayer?: AnimationPlayer;

    private currentTaskText: string = "";
    private missionSubtasks: MissionSubtask[] = [];
    private currentSubtaskIndex: number | null = null;

    private thinkingTextObj!: SceneObject;
    private thinkingText!: Text3D;

    // Live placement preview (PlacingSurface phase only): a translucent
    // ghost of the creature plus a "Pinch to place" hint, continuously
    // repositioned to the current camera-forward hit-test result so the
    // user can see exactly where a pinch will place the companion before
    // committing — see tickPlacementPreview().
    private placementPreviewObj!: SceneObject;
    private placementHintObj!: SceneObject;
    private latestPlacementHit: vec3 | null = null;
    private placementHitTestInFlight: boolean = false;

    private countdownTextObj!: SceneObject;
    private countdownText!: Text3D;
    private remainingSeconds: number = 0;

    private calibrationPanelPos: vec3 = vec3.zero();
    // Captured once at placement time and reused for every popup through the
    // whole setup flow (calibration -> asking task -> thinking -> mission
    // board -> timer -> countdown), instead of each phase re-capturing
    // "whatever direction the camera happens to face right now" — the user's
    // head naturally drifts a little between phases (especially across the
    // 10s calibration hold), so re-capturing per-phase made each popup land
    // at a slightly different orientation than the last.
    private setupPanelRotation: quat = quat.quatIdentity();
    private calibrationElapsed: number = 0;
    private baselineForwardSum: vec3 = vec3.zero();
    private baselineSampleCount: number = 0;
    // Reference direction tickDistraction() compares the live camera-forward
    // vector against. Updated once, at the end of calibration.
    private baselineForward: vec3 = vec3.forward();
    private distractionAwaySeconds: number = 0;
    private distractionBackSeconds: number = 0;
    // Counts up every frame; reset to 0 each time an alert actually fires —
    // see MIN_ALERT_INTERVAL_SECONDS.
    private secondsSinceLastAlert: number = this.MIN_ALERT_INTERVAL_SECONDS;
    private distractionAudio!: AudioComponent;
    private completeAudio?: AudioComponent;
    private distractionHintUI!: DeskCompanionDistractionHintUI;
    // Secondary distraction signal (SnapML via Roboflow's hosted API) —
    // folded into tickDistraction()'s existing sustain/hysteresis alongside
    // the gaze check, so "phone visible" and "looking away" share one
    // Focused/Distracted state machine rather than fighting over it.
    private phoneDetectionService?: PhoneDetectionServiceOnDevice;
    private phoneVisible: boolean = false;

    // Editor-Preview-only affordance: raw HandInputData pinch (see onStart
    // below) is gated on native isTracked() hand state, which neither LEAF's
    // simulated hand nor PreviewInteractTool's Gesture/Pinch actions can
    // reliably drive in Editor Preview (confirmed via LEAF testing). This
    // gives Preview/LEAF an SIK-Interactable-backed way to invoke the exact
    // same onPinch() -> hit-test -> placeCompanion() path a real pinch
    // would. Never created on-device (isEditor() gate), so it has zero
    // footprint on the real Spectacles flow.
    private debugPlacementTrigger?: SceneObject;

    onAwake() {
        const options = HitTestSessionOptions.create();
        options.filter = true;
        this.hitTestSession = this.worldQueryModule.createHitTestSessionWithOptions(options);
        this.hitTestSession.start();

        this.uiFlatTex = createFlatTexture(255, 255, 255, 255);

        // Build the creature + timer UI now (both start hidden/disabled) so
        // OnStartEvent only has to wire input handlers, never construction.
        const creatureObj = global.scene.createSceneObject("Creature");
        creatureObj.setParent(this.sceneObject);
        const faceFrames = [this.faceFrame0, this.faceFrame1, this.faceFrame2, this.faceFrame3, this.faceFrame4]
            .filter((t): t is Texture => !!t);
        this.creature = new DeskCompanionCreature(
            creatureObj, this.baseMaterial, this.CREATURE_RADIUS_CM,
            this.creatureGradientTexture, this.creatureModelPrefab,
            faceFrames.length === 5 ? faceFrames : undefined
        );
        this.creature.setEnabled(false);

        const calibObj = global.scene.createSceneObject("CalibrationUI");
        calibObj.setParent(this.sceneObject);
        this.calibrationUI = new DeskCompanionCalibrationUI(calibObj, this.baseMaterial, this.textMaterial, this.uiFont, this.uiFlatTex);

        const dialogueObj = global.scene.createSceneObject("IntroDialogue");
        dialogueObj.setParent(this.sceneObject);
        const chirpTracks = [this.dialogueChirp0, this.dialogueChirp1, this.dialogueChirp2]
            .filter((c): c is AudioTrackAsset => !!c);
        this.dialogueUI = new DeskCompanionDialogueUI(dialogueObj, this.textMaterial, this.uiFont, chirpTracks);
        this.dialogueUI.onComplete.add(() => this.startCalibration());

        const askTaskObj = global.scene.createSceneObject("AskingTaskPopup");
        askTaskObj.setParent(this.sceneObject);
        this.askingTaskUI = new DeskCompanionAskingTaskUI(askTaskObj, this.textMaterial, this.uiFont);
        this.askingTaskUI.onTaskStated.add((text: string) => this.onTaskStated(text));

        const missionObj = global.scene.createSceneObject("MissionBoard");
        missionObj.setParent(this.sceneObject);
        this.missionBoardUI = new DeskCompanionMissionBoardUI(missionObj, this.textMaterial, this.uiFont);
        this.missionBoardUI.onSubtaskSelected.add((index: number) => this.onSubtaskSelected(index));

        const timerObj = global.scene.createSceneObject("TimerPopup");
        timerObj.setParent(this.sceneObject);
        this.timerUI = new DeskCompanionTimerUI(
            timerObj, this.textMaterial, this.uiFont,
            this.MIN_MINUTES, this.MAX_MINUTES, this.DEFAULT_MINUTES, this.MINUTE_STEP
        );
        this.timerUI.onConfirm.add((minutes: number) => this.onTimerConfirmed(minutes));

        if (this.bookPencilPrefab) {
            const propObj = global.scene.createSceneObject("BookPencilProp");
            propObj.setParent(this.sceneObject);
            this.bookPencilPrefab.instantiate(propObj);
            const animPlayers = getComponentsInDescendantsPortable(propObj, "Component.AnimationPlayer");
            this.bookPencilAnimPlayer = animPlayers.length > 0 ? animPlayers[0] : undefined;
            propObj.enabled = false;
            this.bookPencilObj = propObj;
        }

        this.createPlacementPreview();

        // Countdown display — a single Text3D that floats where the popup was.
        this.countdownTextObj = global.scene.createSceneObject("CountdownText");
        this.countdownTextObj.setParent(this.sceneObject);
        this.countdownText = this.countdownTextObj.createComponent("Component.Text3D") as Text3D;
        this.countdownText.text = "";
        this.countdownText.font = this.uiFont;
        this.countdownText.size = 600;
        const countdownMat = this.textMaterial.clone();
        countdownMat.mainPass.twoSided = true;
        setText3DColor(countdownMat, new vec4(0.95, 0.95, 0.97, 1));
        this.countdownText.mainMaterial = countdownMat;
        this.countdownTextObj.enabled = false;

        // "Thinking..." status while the AI breakdown call is in flight.
        this.thinkingTextObj = global.scene.createSceneObject("ThinkingText");
        this.thinkingTextObj.setParent(this.sceneObject);
        this.thinkingText = this.thinkingTextObj.createComponent("Component.Text3D") as Text3D;
        this.thinkingText.text = "";
        this.thinkingText.font = this.uiFont;
        this.thinkingText.size = 38;
        const thinkingMat = this.textMaterial.clone();
        thinkingMat.mainPass.twoSided = true;
        setText3DColor(thinkingMat, new vec4(0.95, 0.95, 0.97, 1));
        this.thinkingText.mainMaterial = thinkingMat;
        this.thinkingTextObj.enabled = false;

        this.createDistractionAlert(chirpTracks);

        if (this.sessionCompleteSfx) {
            const completeAudioObj = global.scene.createSceneObject("CompleteAudio");
            completeAudioObj.setParent(this.sceneObject);
            this.completeAudio = completeAudioObj.createComponent("Component.AudioComponent") as AudioComponent;
            this.completeAudio.audioTrack = this.sessionCompleteSfx;
        }

        if (this.phoneMlComponent) {
            this.phoneDetectionService = new PhoneDetectionServiceOnDevice(
                this.phoneMlComponent, this.phoneClassIndex, this.phoneDetectionThreshold
            );
            this.phoneDetectionService.onResult.add((visible: boolean) => {
                this.phoneVisible = visible;
            });
        }

        if (global.deviceInfoSystem.isEditor()) {
            this.createDebugPlacementTrigger();
        }

        this.createEvent("OnStartEvent").bind(() => this.onStart());
        this.createEvent("UpdateEvent").bind(() => this.onUpdate());
    }

    private createDebugPlacementTrigger() {
        const obj = global.scene.createSceneObject("DebugPlacementTrigger");
        obj.setParent(this.sceneObject);

        const mat = this.baseMaterial.clone();
        mat.mainPass.blendMode = BlendMode.Disabled;
        mat.mainPass.depthTest = true;
        mat.mainPass.depthWrite = true;
        mat.mainPass.twoSided = true;
        mat.mainPass.baseTex = this.uiFlatTex;
        mat.mainPass.baseColor = new vec4(1, 0, 1, 1); // magenta: unmistakably a debug-only affordance
        buildBoxVisual(obj, mat, 2, 2, 2);

        const collider = obj.createComponent("Physics.ColliderComponent");
        const shape = Shape.createBoxShape();
        shape.size = new vec3(6, 6, 6);
        collider.shape = shape;
        collider.debugDrawEnabled = this.debugColliders;

        const tap = obj.createComponent(TapInteraction.getTypeName()) as TapInteraction;
        tap.onTap.add(() => this.onPinch());

        this.debugPlacementTrigger = obj;
    }

    /**
     * Translucent ghost of the creature body + a "Pinch to place" label,
     * continuously repositioned onto whatever surface the camera is
     * currently pointed at (see tickPlacementPreview). Gives the user a
     * WYSIWYG preview before committing, instead of a blind pinch — the
     * previous flow only ever ran a single hit-test at the moment of the
     * pinch itself, with no feedback beforehand.
     */
    private createPlacementPreview() {
        const previewObj = global.scene.createSceneObject("PlacementPreview");
        previewObj.setParent(this.sceneObject);

        const ghostMat = this.baseMaterial.clone();
        ghostMat.mainPass.blendMode = BlendMode.PremultipliedAlphaAuto;
        ghostMat.mainPass.depthTest = true;
        ghostMat.mainPass.depthWrite = false; // ghost never occludes real geometry
        ghostMat.mainPass.twoSided = true;
        ghostMat.mainPass.baseTex = this.uiFlatTex;
        ghostMat.mainPass.baseColor = new vec4(0.55, 0.78, 0.92, 0.45); // calm blue, translucent
        buildSphereVisual(previewObj, ghostMat, this.CREATURE_RADIUS_CM);
        previewObj.enabled = false;
        this.placementPreviewObj = previewObj;

        const hintObj = global.scene.createSceneObject("PlacementHint");
        hintObj.setParent(this.sceneObject);
        const hintText = hintObj.createComponent("Component.Text3D") as Text3D;
        hintText.text = "Pinch to place";
        hintText.font = this.uiFont;
        hintText.size = 30;
        const hintMat = this.textMaterial.clone();
        hintMat.mainPass.twoSided = true;
        setText3DColor(hintMat, new vec4(0.95, 0.95, 0.97, 1));
        hintText.mainMaterial = hintMat;
        hintObj.enabled = false;
        this.placementHintObj = hintObj;
    }

    /**
     * One-shot audio cue + a small HUD-locked typewriter hint, both fired
     * on the edge into FocusState.Distracted (see tickDistraction/
     * onDistractionDetected) — the message text depends on whether gaze or
     * the phone classifier triggered it (distractionMessage /
     * phoneDistractionMessage). HUD-locked (repositioned to track the
     * camera every frame — see tickDistraction) rather than world-locked
     * like the other popups, so it stays noticeable no matter where the
     * user is looking when the nudge fires. Reuses the intro dialogue's
     * chirp tracks for its own typewriter "voice" rather than requiring a
     * separate set of audio assets.
     */
    private createDistractionAlert(chirpTracks: AudioTrackAsset[]) {
        const audioObj = global.scene.createSceneObject("DistractionAudio");
        audioObj.setParent(this.sceneObject);
        this.distractionAudio = audioObj.createComponent("Component.AudioComponent") as AudioComponent;
        this.distractionAudio.audioTrack = this.distractionSfx;

        const hintObj = global.scene.createSceneObject("DistractionHint");
        hintObj.setParent(this.sceneObject);
        this.distractionHintUI = new DeskCompanionDistractionHintUI(hintObj, this.textMaterial, this.uiFont, chirpTracks);
    }

    private onStart() {
        // Raw HandInputData pinch — stable-core SIK, portable per
        // spectacles-522-portable-design. Right hand only for this pass.
        const hand = HandInputData.getInstance().getHand("right");
        hand.onPinchDown.add(() => this.onPinch());
    }

    private onUpdate() {
        const dt = getDeltaTime();
        this.creature.fresnelBrightness = this.fresnelBrightness;
        this.creature.update(dt);

        // Face the user continuously through the whole setup flow (a lively,
        // smoothly-lerped turn, not a snap) — but hold still once a focus
        // countdown starts, so it isn't just staring at the user through the
        // whole session (and, once bookPencilPrefab is wired, can eventually
        // be posed toward its desk props instead).
        if (this.phase !== CompanionPhase.PlacingSurface && this.phase !== CompanionPhase.CountingDown) {
            const cam = WorldCameraFinderProvider.getInstance();
            this.creature.updateFacing(cam.getWorldPosition(), dt);
        }

        if (this.phase === CompanionPhase.IntroDialogue) {
            this.dialogueUI.update(dt);
        }

        if (this.phase === CompanionPhase.Calibrating) {
            this.tickCalibration(dt);
        }

        if (this.phase === CompanionPhase.CountingDown) {
            this.tickCountdown(dt);
            // tickCountdown() can end the session and change phase (via
            // onCountdownComplete -> showMissionBoard/Complete) partway
            // through this block — re-check before continuing, otherwise a
            // distraction check still lands on the same frame the session
            // just ended, and can re-open the distraction hint panel right
            // after onCountdownComplete() already hid it. Because the phase
            // has already moved on by then, tickDistraction() (and the
            // typewriter update() inside it) never runs again, leaving that
            // panel stuck floating on screen showing its pre-typewriter
            // blank state.
            if (this.phase === CompanionPhase.CountingDown) {
                if (this.phoneDetectionService) {
                    this.phoneDetectionService.tick();
                }
                this.tickDistraction(dt);
            }
        }

        if (this.debugPlacementTrigger && this.phase === CompanionPhase.PlacingSurface) {
            // Float in front of the camera so it's reachable regardless of
            // where the placement ray happens to be aimed.
            const cam = WorldCameraFinderProvider.getInstance();
            const t = this.debugPlacementTrigger.getTransform();
            t.setWorldPosition(cam.getForwardPosition(40));
            t.setWorldRotation(cam.getTransform().getWorldRotation());
        }

        if (this.phase === CompanionPhase.PlacingSurface) {
            this.tickPlacementPreview();
        }
    }

    // ---------------- Placement (World/Surface Tracking + pinch) ----------------

    /**
     * Runs the same camera-forward hit-test every frame during
     * PlacingSurface so the ghost preview always reflects where a pinch
     * would place the companion right now. `placementHitTestInFlight`
     * prevents overlapping async hitTest callbacks from piling up if a
     * result takes longer than one frame to come back.
     */
    private tickPlacementPreview() {
        if (this.placementHitTestInFlight) return;
        this.placementHitTestInFlight = true;

        const cam = WorldCameraFinderProvider.getInstance();
        const rayStart = cam.getWorldPosition();
        const rayEnd = cam.getForwardPosition(this.PLACEMENT_RAY_LENGTH_CM);

        this.hitTestSession.hitTest(rayStart, rayEnd, (result) => {
            this.placementHitTestInFlight = false;
            this.onPlacementPreviewResult(result);
        });
    }

    private onPlacementPreviewResult(result: WorldQueryHitTestResult | null) {
        if (this.phase !== CompanionPhase.PlacingSurface) return; // stale callback guard

        if (!result || result.normal.y < this.SURFACE_FLATNESS_MIN_Y) {
            // No surface in view, or too steep (e.g. a wall) — nothing to place onto.
            this.latestPlacementHit = null;
            this.placementPreviewObj.enabled = false;
            this.placementHintObj.enabled = false;
            return;
        }

        this.latestPlacementHit = result.position;

        this.placementPreviewObj.enabled = true;
        this.placementPreviewObj.getTransform().setWorldPosition(result.position);

        const cam = WorldCameraFinderProvider.getInstance();
        this.placementHintObj.enabled = true;
        this.placementHintObj.getTransform().setWorldPosition(
            result.position.add(new vec3(0, this.CREATURE_RADIUS_CM * 2 + 3, 0))
        );
        this.placementHintObj.getTransform().setWorldRotation(cam.getTransform().getWorldRotation());
    }

    /** Commits the surface currently shown by the live preview — no separate hit-test at pinch time, so placement always matches exactly what was previewed. */
    private onPinch() {
        if (this.phase !== CompanionPhase.PlacingSurface) return;
        if (!this.latestPlacementHit) return; // no valid surface currently tracked

        this.placeCompanion(this.latestPlacementHit);
    }

    private placeCompanion(surfacePos: vec3) {
        this.creature.placeAt(surfacePos);
        this.creature.setEnabled(true);

        this.placementPreviewObj.enabled = false;
        this.placementHintObj.enabled = false;
        this.latestPlacementHit = null;

        // Popup panels float just above the creature, oriented to match the
        // camera at the moment placement happens (see DeskCompanionTimerUI
        // .show for why we copy rotation rather than "look at" it — lookAt
        // mirrors text/button layout). Captured once here into
        // setupPanelRotation and reused for every later popup in the flow
        // so they all share one consistent orientation.
        this.calibrationPanelPos = new vec3(
            surfacePos.x, this.creature.getTopWorldY() + this.PANEL_ABOVE_CREATURE_CM, surfacePos.z
        );
        const cam = WorldCameraFinderProvider.getInstance();
        // Yaw only — flatten out the camera's pitch/roll so the panel
        // stands upright (like a sign) instead of inheriting however far
        // the user was looking down at their desk when they placed the
        // companion, which made a full rotation-copy tilt the panel to lie
        // nearly flat. quat.lookAt(direction, up) also gives us an
        // independent value (not a live-aliased getter reference), so this
        // still only "captures" once, same as before.
        const camForward = cam.getTransform().forward;
        const flatForward = new vec3(camForward.x, 0, camForward.z);
        const yawDir = flatForward.lengthSquared > 0.0001 ? flatForward.normalize() : vec3.back();
        this.setupPanelRotation = quat.lookAt(yawDir, vec3.up());

        if (this.bookPencilObj) {
            const right = this.setupPanelRotation.multiplyVec3(vec3.right());
            this.bookPencilObj.getTransform().setWorldPosition(
                surfacePos.add(right.uniformScale(this.BOOK_PENCIL_SIDE_OFFSET_CM))
            );
            this.bookPencilObj.getTransform().setWorldRotation(this.setupPanelRotation);
        }

        this.dialogueUI.play(INTRO_DIALOGUE_STEPS, this.calibrationPanelPos, this.setupPanelRotation);
        this.phase = CompanionPhase.IntroDialogue;

        // This hit-test session is single-purpose (placement only) — stop it
        // once placed so it isn't spending depth-compute budget for nothing.
        this.hitTestSession.stop();

        if (this.debugPlacementTrigger) {
            this.debugPlacementTrigger.enabled = false;
        }
    }

    /** Fired by dialogueUI.onComplete once the scripted intro finishes — begins the real 10s gaze-hold calibration. */
    private startCalibration() {
        this.calibrationUI.show(this.calibrationPanelPos, this.setupPanelRotation);

        this.calibrationElapsed = 0;
        this.baselineForwardSum = vec3.zero();
        this.baselineSampleCount = 0;
        this.phase = CompanionPhase.Calibrating;
    }

    // ---------------- Calibration (baseline gaze direction) ----------------

    private tickCalibration(deltaTime: number) {
        // Sample the camera's forward vector every frame and average it —
        // the running average is the calibrated "looking at the workspace"
        // baseline a future distraction detector compares live gaze against.
        const cam = WorldCameraFinderProvider.getInstance();
        this.baselineForwardSum = this.baselineForwardSum.add(cam.getTransform().forward);
        this.baselineSampleCount++;

        // HUD-locked: track the camera every frame so the panel — and its
        // "hold your gaze" instruction — stays directly in front of the user
        // no matter how their head drifts during the hold, instead of being
        // fixed at the world position it was first shown at.
        this.calibrationUI.setWorldPose(cam.getForwardPosition(50), cam.getTransform().getWorldRotation());

        this.calibrationElapsed += deltaTime;
        const progress = this.calibrationElapsed / this.CALIBRATION_DURATION_SECONDS;
        const remaining = this.CALIBRATION_DURATION_SECONDS - this.calibrationElapsed;
        this.calibrationUI.setProgress(progress, remaining);

        if (this.calibrationElapsed >= this.CALIBRATION_DURATION_SECONDS) {
            this.finishCalibration();
        }
    }

    private finishCalibration() {
        if (this.baselineSampleCount > 0) {
            this.baselineForward = this.baselineForwardSum.uniformScale(1 / this.baselineSampleCount).normalize();
        }
        this.calibrationUI.hide();

        this.askingTaskUI.show(this.calibrationPanelPos, this.setupPanelRotation);
        this.phase = CompanionPhase.AskingTask;
    }

    /** EXTENSION POINT — the calibrated reference direction; compare live `cam.getTransform().forward` against this to decide focused vs. distracted. */
    getBaselineForward(): vec3 {
        return this.baselineForward;
    }

    // ---------------- Task -> AI breakdown -> mission board ----------------

    private onTaskStated(taskText: string) {
        if (this.phase !== CompanionPhase.AskingTask) return;

        this.currentTaskText = taskText;
        this.askingTaskUI.hide();

        this.thinkingText.text = "Let me break that down...";
        this.thinkingTextObj.getTransform().setWorldPosition(this.calibrationPanelPos);
        this.thinkingTextObj.getTransform().setWorldRotation(this.setupPanelRotation);
        this.thinkingTextObj.enabled = true;

        this.phase = CompanionPhase.BreakingDown;

        // breakDownTask() never rejects — it falls back to a generic 3-way
        // split internally on network/parse failure, so the mission flow
        // never dead-ends offline or on an AI error (see TaskBreakdownService.ts).
        breakDownTask(taskText, this).then((steps) => this.onBreakdownReady(steps));
    }

    private onBreakdownReady(steps: string[]) {
        if (this.phase !== CompanionPhase.BreakingDown) return; // stale callback guard

        this.thinkingTextObj.enabled = false;
        this.missionSubtasks = steps.map((text) => ({ text, done: false }));
        this.showMissionBoard();
    }

    private showMissionBoard() {
        this.missionBoardUI.show(this.calibrationPanelPos, this.setupPanelRotation);
        this.missionBoardUI.setTask(this.currentTaskText);
        this.missionBoardUI.setSubtasks(this.missionSubtasks.map((t) => t.text));
        for (let i = 0; i < this.missionSubtasks.length; i++) {
            this.missionBoardUI.setSubtaskDone(i, this.missionSubtasks[i].done);
        }
        this.phase = CompanionPhase.MissionBoard;
    }

    private onSubtaskSelected(index: number) {
        if (this.phase !== CompanionPhase.MissionBoard) return;
        const subtask = this.missionSubtasks[index];
        if (!subtask || subtask.done) return; // already finished — ignore taps on a ticked card

        this.currentSubtaskIndex = index;
        this.missionBoardUI.hide();

        this.timerUI.show(this.calibrationPanelPos, this.setupPanelRotation);
        this.phase = CompanionPhase.SettingTimer;
    }

    // ---------------- Timer setup -> countdown ----------------

    private onTimerConfirmed(minutes: number) {
        if (this.phase !== CompanionPhase.SettingTimer) return;

        this.timerUI.hide();

        const countdownPos = new vec3(
            this.calibrationPanelPos.x,
            this.creature.getTopWorldY() + this.COUNTDOWN_ABOVE_CREATURE_CM,
            this.calibrationPanelPos.z
        );
        this.countdownTextObj.getTransform().setWorldPosition(countdownPos);
        this.countdownTextObj.getTransform().setWorldRotation(this.setupPanelRotation);

        this.remainingSeconds = minutes * 60;
        this.countdownTextObj.enabled = true;
        this.updateCountdownText();

        this.distractionAwaySeconds = 0;
        this.distractionBackSeconds = 0;
        this.secondsSinceLastAlert = this.MIN_ALERT_INTERVAL_SECONDS; // ready to fire on the first genuine distraction
        this.phoneVisible = false;
        this.creature.setFocusState(FocusState.Focused);
        this.creature.setBookVisible(true); // no-op if creatureModelPrefab has no "book" child

        if (this.bookPencilObj) {
            this.bookPencilObj.enabled = true;
            if (this.bookPencilAnimPlayer) {
                this.bookPencilAnimPlayer.playAll();
            }
        }

        this.phase = CompanionPhase.CountingDown;
    }

    // ---------------- Countdown ----------------

    private tickCountdown(deltaTime: number) {
        this.remainingSeconds -= deltaTime;
        if (this.remainingSeconds <= 0) {
            this.remainingSeconds = 0;
            this.updateCountdownText();
            this.onCountdownComplete();
            return;
        }
        this.updateCountdownText();
    }

    // ---------------- Distraction detection (gaze vs. calibrated baseline) ----------------

    /**
     * Compares live camera-forward against the calibrated baseline direction
     * every frame during CountingDown. Entering Distracted is OR-ed with the
     * on-device phone-detection result (phoneDetectionService.tick() above)
     * — either signal alone is enough to flag distraction. Recovering to
     * Focused is judged on gaze ALONE: the phone detector only knows a phone
     * is somewhere in the camera's wide field of view, not whether the user
     * is actually looking at it, so a lingering/false-positive reading must
     * never be able to block recovery once the user's gaze has genuinely
     * returned to the creature. Both transitions still require their own
     * sustain window (DISTRACTION_SUSTAIN_SECONDS / REFOCUS_SUSTAIN_SECONDS)
     * so a quick glance or a single stray detection doesn't flicker the tint.
     */
    private tickDistraction(deltaTime: number) {
        const cam = WorldCameraFinderProvider.getInstance();
        const dot = Math.max(-1, Math.min(1, cam.getTransform().forward.dot(this.baselineForward)));
        const angleDeg = Math.acos(dot) * (180 / Math.PI);
        const gazeAway = angleDeg > this.DISTRACTION_ANGLE_DEG;

        this.distractionAwaySeconds = (gazeAway || this.phoneVisible) ? this.distractionAwaySeconds + deltaTime : 0;
        this.distractionBackSeconds = !gazeAway ? this.distractionBackSeconds + deltaTime : 0;
        this.secondsSinceLastAlert += deltaTime;

        if (this.distractionAwaySeconds >= this.DISTRACTION_SUSTAIN_SECONDS
            && this.creature.getFocusState() !== FocusState.Distracted) {
            this.creature.setFocusState(FocusState.Distracted);
            // Clear any lingering "back" accumulation (e.g. gaze has been on
            // the workspace the whole time while a lingering/noisy phone
            // reading was what actually tripped this) so REFOCUS_SUSTAIN_
            // SECONDS is judged fresh from here, not instantly satisfied by
            // time that already accumulated before Distracted even started —
            // without this, a persistent false-positive phone reading could
            // bounce straight back to Focused and re-trigger every few
            // seconds instead of respecting the sustain window.
            this.distractionBackSeconds = 0;
            // Which message to show is decided by whatever's true right at
            // the moment the sustain threshold crosses — not a perfect
            // signal if both gaze-away and phone-visible were intermittently
            // true during the 3s window, but matches the ask directly: "when
            // the player looks at the phone for 3s, show the phone message".
            // Still throttled by MIN_ALERT_INTERVAL_SECONDS below — a noisy
            // classifier flipping this state repeatedly shouldn't spam the
            // sound/hint every few seconds.
            if (this.secondsSinceLastAlert >= this.MIN_ALERT_INTERVAL_SECONDS) {
                this.onDistractionDetected(this.phoneVisible);
                this.secondsSinceLastAlert = 0;
            }
        }
        if (this.distractionBackSeconds >= this.REFOCUS_SUSTAIN_SECONDS
            && this.creature.getFocusState() !== FocusState.Focused) {
            this.creature.setFocusState(FocusState.Focused);
            this.onRefocusDetected();
            // Clear any lingering "away" accumulation (e.g. a stuck phone
            // reading) so it can't immediately re-trigger Distracted the
            // instant the user refocuses — a fresh sustained signal is
            // required to flag distraction again.
            this.distractionAwaySeconds = 0;
        }

        // HUD-locked: track the camera every frame while the hint is up, so
        // it stays in view no matter where the user looks next. Typewriter
        // animation also needs ticking every frame it's up.
        if (this.distractionHintUI.isVisible()) {
            this.distractionHintUI.setWorldPose(cam.getForwardPosition(50), cam.getTransform().getWorldRotation());
        }
        this.distractionHintUI.update(deltaTime);
    }

    /** Fires once on the edge into Distracted — one-shot audio cue + HUD-locked typewriter hint. */
    private onDistractionDetected(causedByPhone: boolean) {
        this.distractionAudio.play(1);
        const cam = WorldCameraFinderProvider.getInstance();
        const message = causedByPhone ? this.phoneDistractionMessage : this.distractionMessage;
        this.distractionHintUI.show(message, cam.getForwardPosition(50), cam.getTransform().getWorldRotation());
    }

    /** Fires once on the edge back to Focused — clears the hint (audio is a one-shot, nothing to stop). */
    private onRefocusDetected() {
        this.distractionHintUI.hide();
    }

    private updateCountdownText() {
        const totalSeconds = Math.ceil(this.remainingSeconds);
        const mm = Math.floor(totalSeconds / 60);
        const ss = totalSeconds % 60;
        this.countdownText.text = `${mm}:${ss < 10 ? "0" : ""}${ss}`;
    }

    private onCountdownComplete() {
        this.countdownTextObj.enabled = false;
        this.creature.setFocusState(FocusState.Neutral); // back to calm default outside a focus session
        this.creature.setBookVisible(false);
        this.distractionHintUI.hide();

        if (this.bookPencilObj) {
            this.bookPencilObj.enabled = false;
            if (this.bookPencilAnimPlayer) {
                this.bookPencilAnimPlayer.stopAll();
            }
        }

        if (this.currentSubtaskIndex !== null) {
            this.missionSubtasks[this.currentSubtaskIndex].done = true;
            this.currentSubtaskIndex = null;
        }

        const allDone = this.missionSubtasks.every((t) => t.done);
        if (allDone) {
            this.phase = CompanionPhase.Complete;
            this.countdownText.text = "All done for today!";
            this.countdownTextObj.enabled = true;
            if (this.completeAudio) {
                this.completeAudio.play(1);
            }
        } else {
            this.showMissionBoard();
        }
    }
}
