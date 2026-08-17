// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// On-device phone-presence signal for creature.ts's distraction detector —
// same onResult(boolean) event shape regardless of what runs underneath, so
// tickDistraction() never needs to change when the model does. Reads a
// 2-class softmax output ("probabilities": [class0, class1]) directly from
// MLComponent — no anchor decoding/NMS needed, this is a binary classifier,
// not a detector.

import Event from "SpectaclesInteractionKit.lspkg/Utils/Event";

const OUTPUT_NAME = "probabilities";

export class PhoneDetectionServiceOnDevice {
    public onResult: Event<boolean> = new Event<boolean>();

    private cameraModule: CameraModule = require("LensStudio:CameraModule");
    private ready: boolean = false;

    constructor(
        private mlComponent: MLComponent,
        private phoneClassIndex: number,
        private threshold: number
    ) {
        this.startCamera();
    }

    private startCamera() {
        // getInput()/getOutput() throw until the model has actually finished
        // loading — defer both the texture assignment and the "ready" flag
        // to onLoadingFinished.
        const priorHandler = this.mlComponent.onLoadingFinished;
        this.mlComponent.onLoadingFinished = () => {
            if (priorHandler) {
                priorHandler();
            }
            const req = CameraModule.createCameraRequest();
            req.cameraId = global.deviceInfoSystem.isEditor()
                ? CameraModule.CameraId.Default_Color
                : CameraModule.CameraId.Right_Color;
            const camTex = this.cameraModule.requestCamera(req);
            this.mlComponent.getInput("data").texture = camTex;
            this.ready = true;
        };
    }

    /** Call once per frame during CountingDown. Cheap — direct softmax read, no network round-trip, no box decoding. */
    public tick() {
        if (!this.ready) return; // model/camera still loading

        const probabilities = this.mlComponent.getOutput(OUTPUT_NAME).data;
        const phoneProbability = probabilities[this.phoneClassIndex];
        this.onResult.invoke(phoneProbability >= this.threshold);
    }
}
