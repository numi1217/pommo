// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Portable (5.15-safe) runtime mesh helpers built on the core MeshBuilder API.
// No custom shaders, no external assets, no packages beyond the engine core —
// pure procedural geometry. Verified CCW winding from outside (see the
// ls-clad mesh-builder-scripting skill this was adapted from).
//
// Every helper here assumes the same standard vertex layout (position +
// normal + color + texture0/UV) even though this project tints geometry via
// cloned ImageMaterialPreset baseColor rather than per-vertex color — the
// color stream is simply unused by that shader, which is harmless and lets
// us reuse the winding-verified reference implementations unmodified.
// "texture0" (2 components) is the standard MeshBuilder UV attribute name —
// confirmed against SpectaclesInteractionKit's LineRenderer usage — and is
// what a material's baseTex sampling (system.getSurfaceUVCoord0()) reads.

export type RGBA = [number, number, number, number];

const UNUSED_COLOR: RGBA = [1, 1, 1, 1];

/** Standard vertex layout used by every helper in this file. */
export function createStandardMeshBuilder(): MeshBuilder {
    const builder = new MeshBuilder([
        { name: "position", components: 3 },
        { name: "normal", components: 3, normalized: true },
        { name: "color", components: 4 },
        { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;
    return builder;
}

/**
 * Axis-aligned box centered at (cx, cy, cz) with half-extents (hw, hh, hd).
 * Appends 24 verts (4 per face, each carrying that face's outward normal)
 * with verified CCW winding. `indices` is an array owned by the caller —
 * call `builder.appendIndices(indices)` once after all shapes are added.
 * Returns the next free vertex index (pass as baseIdx to chain more
 * geometry onto the same builder).
 */
export function addBox(
    builder: MeshBuilder,
    indices: number[],
    cx: number, cy: number, cz: number,
    hw: number, hh: number, hd: number,
    color: RGBA,
    baseIdx: number
): number {
    const x0 = cx - hw, x1 = cx + hw;
    const y0 = cy - hh, y1 = cy + hh;
    const z0 = cz - hd, z1 = cz + hd;

    let vi = baseIdx;

    const face = (
        p0: [number, number, number],
        p1: [number, number, number],
        p2: [number, number, number],
        p3: [number, number, number],
        n: [number, number, number],
    ) => {
        builder.appendVerticesInterleaved([
            ...p0, ...n, ...color, 0, 0,
            ...p1, ...n, ...color, 1, 0,
            ...p2, ...n, ...color, 1, 1,
            ...p3, ...n, ...color, 0, 1,
        ]);
        // CCW from outside: p0 -> p1 -> p2 -> p3 traces counter-clockwise
        indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        vi += 4;
    };

    face([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);  // +X
    face([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]); // -X
    face([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);  // +Y
    face([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]); // -Y
    face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);  // +Z
    face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]); // -Z

    return vi;
}

/**
 * Revolves a [radius, height] profile (bottom -> top, radius >= 0) around
 * the Y axis. Caps are added automatically when an endpoint has non-zero
 * radius. Appends its own indices internally.
 */
export function buildLathe(
    builder: MeshBuilder,
    profile: [number, number][],
    segments: number,
    color: RGBA,
    baseIdx: number = 0,
): number {
    const P = profile.length;
    let vi = baseIdx;
    const startIdx = vi;
    const indices: number[] = [];

    // Profile tangent -> outward 2D normal = (dy, -dx), normalized
    const prof2dN: [number, number][] = [];
    for (let j = 0; j < P; j++) {
        const prev = profile[Math.max(0, j - 1)];
        const next = profile[Math.min(P - 1, j + 1)];
        const dx = next[0] - prev[0], dy = next[1] - prev[1];
        const len = Math.hypot(dy, -dx) || 1;
        prof2dN.push([dy / len, -dx / len]);
    }

    // Emit (segments+1) rings x P vertices (duplicated seam for clean UVs).
    // u wraps around the revolve axis, v runs along the profile (0 at
    // profile[0] -> 1 at profile[P-1]) so a texture reads bottom-to-top.
    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const c = Math.cos(theta), s = Math.sin(theta);
        const u = i / segments;
        for (let j = 0; j < P; j++) {
            const [r, y] = profile[j];
            const [n2x, n2y] = prof2dN[j];
            const v = j / (P - 1);
            builder.appendVerticesInterleaved([
                r * c, y, r * s,
                n2x * c, n2y, n2x * s,
                ...color,
                u, v,
            ]);
            vi++;
        }
    }

    // Side quads
    for (let i = 0; i < segments; i++) {
        for (let j = 0; j < P - 1; j++) {
            const bl = startIdx + i * P + j;
            const br = startIdx + i * P + (j + 1);
            const tl = startIdx + (i + 1) * P + j;
            const tr = startIdx + (i + 1) * P + (j + 1);
            indices.push(bl, br, tr, bl, tr, tl);
        }
    }

    // Bottom cap (normal -Y)
    if (profile[0][0] > 1e-6) {
        const y = profile[0][1], r = profile[0][0];
        const center = vi;
        builder.appendVerticesInterleaved([0, y, 0, 0, -1, 0, ...color, 0.5, 0]); vi++;
        const ring = vi;
        for (let i = 0; i <= segments; i++) {
            const th = (i / segments) * Math.PI * 2;
            builder.appendVerticesInterleaved([r * Math.cos(th), y, r * Math.sin(th), 0, -1, 0, ...color, i / segments, 0]); vi++;
        }
        for (let i = 0; i < segments; i++) indices.push(center, ring + i, ring + i + 1);
    }

    // Top cap (normal +Y)
    if (profile[P - 1][0] > 1e-6) {
        const y = profile[P - 1][1], r = profile[P - 1][0];
        const center = vi;
        builder.appendVerticesInterleaved([0, y, 0, 0, 1, 0, ...color, 0.5, 1]); vi++;
        const ring = vi;
        for (let i = 0; i <= segments; i++) {
            const th = (i / segments) * Math.PI * 2;
            builder.appendVerticesInterleaved([r * Math.cos(th), y, r * Math.sin(th), 0, 1, 0, ...color, i / segments, 1]); vi++;
        }
        for (let i = 0; i < segments; i++) indices.push(center, ring + i + 1, ring + i);
    }

    builder.appendIndices(indices);
    return vi;
}

/**
 * Simple UV-sphere of the given radius. Rests with its bottom pole at local
 * Y=0 — placing the owning SceneObject's origin at a surface hit point makes
 * the sphere sit ON that surface (foot-on-floor), not float through it.
 */
export function buildSphere(
    builder: MeshBuilder,
    radius: number,
    segments: number = 20,
    rings: number = 12,
    color: RGBA = UNUSED_COLOR,
    baseIdx: number = 0
): number {
    const profile: [number, number][] = [];
    for (let j = 0; j <= rings; j++) {
        const t = j / rings; // 0..1
        const theta = -Math.PI / 2 + t * Math.PI; // -90deg .. +90deg
        const r = Math.max(radius * Math.cos(theta), 0);
        const y = radius + radius * Math.sin(theta); // bottom pole at y=0, top pole at y=2*radius
        profile.push([r, y]);
    }
    return buildLathe(builder, profile, segments, color, baseIdx);
}

/** Builds a RenderMeshVisual on `owner` from a flat box of half-extents (hw, hh, hd), centered on the object's local origin. */
export function buildBoxVisual(
    owner: SceneObject,
    material: Material,
    hw: number, hh: number, hd: number,
    color: RGBA = UNUSED_COLOR
): RenderMeshVisual {
    const builder = createStandardMeshBuilder();
    const indices: number[] = [];
    addBox(builder, indices, 0, 0, 0, hw, hh, hd, color, 0);
    builder.appendIndices(indices);

    const rmv = owner.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    rmv.mesh = builder.getMesh();
    rmv.mainMaterial = material;
    builder.updateMesh();
    return rmv;
}

/** Builds a RenderMeshVisual on `owner` from a sphere resting on the object's local origin (see buildSphere). */
export function buildSphereVisual(
    owner: SceneObject,
    material: Material,
    radius: number,
    color: RGBA = UNUSED_COLOR
): RenderMeshVisual {
    const builder = createStandardMeshBuilder();
    buildSphere(builder, radius, 20, 12, color, 0);

    const rmv = owner.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    rmv.mesh = builder.getMesh();
    rmv.mainMaterial = material;
    builder.updateMesh();
    return rmv;
}
