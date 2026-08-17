// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Polls a hosted Roboflow object-detection model with periodic camera
// snapshots and fires onResult(true) when a phone is detected above the
// confidence threshold. Network/parse failures resolve to "no phone seen"
// rather than throwing, so a flaky connection never breaks a focus session.
// call tick(deltaTime) once per frame during CountingDown only — the poll
// itself is internally throttled to POLL_INTERVAL_SECONDS.

import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

const POLL_INTERVAL_SECONDS = 4;

interface RoboflowPrediction {
    class: string;
    confidence: number;
}

interface RoboflowResponse {
    predictions?: RoboflowPrediction[];
}

export class PhoneDetectionService {
    public onResult: Event<boolean> = new Event<boolean>();

    private cameraModule: CameraModule = require("LensStudio:CameraModule");
    private internetModule: InternetModule = require("LensStudio:InternetModule");
    private cameraTexture!: Texture;
    private cameraReady: boolean = false;
    private requestInFlight: boolean = false;
    // Starts primed so the first tick() past onAwake polls immediately
    // instead of waiting a full interval.
    private elapsedSinceLastPoll: number = POLL_INTERVAL_SECONDS;

    constructor(
        private apiKey: string,
        private modelId: string,
        private confidenceThreshold: number
    ) {
        if (this.apiKey && this.modelId) {
            this.startCamera();
        }
    }

    private startCamera() {
        const req = CameraModule.createCameraRequest();
        req.cameraId = global.deviceInfoSystem.isEditor()
            ? CameraModule.CameraId.Default_Color
            : CameraModule.CameraId.Right_Color;
        this.cameraTexture = this.cameraModule.requestCamera(req);
        const provider = this.cameraTexture.control as CameraTextureProvider;
        provider.onNewFrame.add(() => {
            this.cameraReady = true;
        });
    }

    /** No-ops (no camera, no key/model configured, or interval not yet elapsed). */
    public tick(deltaTime: number) {
        if (!this.cameraReady || this.requestInFlight) return;

        this.elapsedSinceLastPoll += deltaTime;
        if (this.elapsedSinceLastPoll < POLL_INTERVAL_SECONDS) return;
        this.elapsedSinceLastPoll = 0;

        this.pollOnce();
    }

    private pollOnce() {
        this.requestInFlight = true;
        Base64.encodeTextureAsync(
            this.cameraTexture,
            (b64: string) => this.sendToRoboflow(b64),
            () => { this.requestInFlight = false; }, // encode failed — skip this poll
            CompressionQuality.HighQuality,
            EncodingType.Jpg
        );
    }

    private sendToRoboflow(imageB64: string) {
        const url = `https://serverless.roboflow.com/${this.modelId}?api_key=${this.apiKey}`;
        const request = new Request(url, {
            method: "POST",
            body: imageB64,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        this.internetModule.fetch(request)
            .then((response) => response.json())
            .then((data: RoboflowResponse) => {
                const predictions = data.predictions ?? [];
                const phoneVisible = predictions.some((p) =>
                    p.confidence >= this.confidenceThreshold && /phone/i.test(p.class)
                );
                this.onResult.invoke(phoneVisible);
            })
            .catch(() => {
                // network/parse failure — treat as "no phone seen", never break the session
            })
            .finally(() => {
                this.requestInFlight = false;
            });
    }
}
