// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// ImageMaterialPreset clones default their baseTex to the engine's
// placeholder "missing image" icon (Image.png) unless explicitly overridden.
// Every UI panel/button/pip in this project only sets baseColor on its
// clone, so they were all rendering that broken-image glyph tinted by their
// panel color. ProceduralTextureProvider builds a 1x1 solid-color texture
// entirely in code (5.15-safe API, no asset file needed) to replace it.

export function createFlatTexture(r: number, g: number, b: number, a: number = 255): Texture {
    const tex = ProceduralTextureProvider.createWithFormat(1, 1, TextureFormat.RGBA8Unorm);
    const provider = tex.control as ProceduralTextureProvider;
    provider.setPixels(0, 0, 1, 1, new Uint8Array([r, g, b, a]));
    return tex;
}
