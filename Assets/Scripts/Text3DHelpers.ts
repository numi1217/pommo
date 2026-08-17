// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Text3DMaterialPreset does NOT expose a `baseColor` port like
// ImageMaterialPreset does — it's a gradient/PBR-capable shader with
// separate outerEdge / innerEdge / frontCap / backCap start+end colors
// (see Mode: Texture|Gradient|Solid, default "Gradient"). Setting all eight
// color ports to the same value collapses the gradient into a uniform solid
// tint without touching the `Mode` shader define (a compile-time variant
// selector we don't trust as a safe runtime write). This is the only
// reliable way to tint Text3D on a clone.

export function setText3DColor(material: Material, color: vec4) {
    const p = material.mainPass;
    p.outerEdgeStartingColor = color;
    p.outerEdgeEndingColor = color;
    p.innerEdgeStartingColor = color;
    p.innerEdgeEndingColor = color;
    p.frontCapStartingColor = color;
    p.frontCapEndingColor = color;
    p.backCapStartingColor = color;
    p.backCapEndingColor = color;
}
