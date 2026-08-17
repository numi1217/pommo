// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Portable (5.15-safe) SceneObject helpers. `SceneObject.getComponentsInDescendants`
// does not exist in 5.15's API surface (confirmed against a real 5.15.4 compile —
// it's not version-gated, it's genuinely absent) — 5.15 only has getComponent(s)
// (direct children) plus manual getChild()/getChildrenCount() traversal, so this
// walks the hierarchy by hand instead.

/**
 * Every component of type `componentType` on `root` and all of its descendants
 * (BFS, root included) — the portable equivalent of `root.getComponentsInDescendants
 * (componentType, false, true)` on 5.22+, minus the onlyEnabled filter (not needed
 * by any caller in this project; add one if a future caller needs it).
 */
export function getComponentsInDescendantsPortable<K extends keyof ComponentNameMap>(
    root: SceneObject,
    componentType: K
): ComponentNameMap[K][] {
    const result: ComponentNameMap[K][] = [];
    const queue: SceneObject[] = [root];
    while (queue.length > 0) {
        const obj = queue.shift() as SceneObject;
        result.push(...obj.getComponents(componentType));
        for (let i = 0; i < obj.getChildrenCount(); i++) {
            queue.push(obj.getChild(i));
        }
    }
    return result;
}
