// Copyright 2026 Specs Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Wraps a single OpenAI chat-completions call (via RemoteServiceGateway) that
// turns one freeform task description into exactly 3 short sub-steps.
// Defensively pads/truncates the model's response to always return exactly 3
// non-empty strings — a malformed or short AI response should never break
// the mission board UI downstream.
//
// REQUEST_TIMEOUT_SECONDS races the network call against a timer: a
// rejection (bad key, offline, malformed response) already falls through to
// the generic 3-way split below, but a request that just never settles — no
// response, no error, e.g. a stalled connection — would otherwise leave
// the .catch() waiting forever and strand the user on "Let me break that
// down..." with no fallback ever firing. Confirmed this can genuinely
// happen in Editor Preview, not just a theoretical edge case.

import { OpenAI } from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI";

const REQUEST_TIMEOUT_SECONDS = 12;

// DelayedCallbackEvent, not global setTimeout — confirmed absent from the
// 5.15 target's StudioLib.d.ts entirely (not version-gated, genuinely
// doesn't exist there), while DelayedCallbackEvent is the portable native
// equivalent. It can only be created via a ScriptComponent's own
// createEvent(), so this needs the caller's own component passed in — see
// breakDownTask's hostScript parameter. Verified firing end-to-end; its
// delay is frame-time, not wall-clock, so it only advances while the Lens
// is actually rendering frames (a real device or an actively-viewed
// Preview session) — a Preview left idle between actions will make it
// appear to take far longer than REQUEST_TIMEOUT_SECONDS suggests.
function timeoutAfter(hostScript: BaseScriptComponent, seconds: number): Promise<never> {
    return new Promise((_, reject) => {
        const event = hostScript.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
        event.bind(() => reject(new Error("breakDownTask timed out")));
        event.reset(seconds);
    });
}

const SYSTEM_PROMPT =
    "You are a gentle, encouraging desk companion helping someone plan their day. " +
    "The user will describe one task they want to accomplish. Break it into exactly " +
    "3 small, concrete, sequential sub-steps that together complete the task. " +
    "Respond with ONLY the 3 steps, one per line, no numbering, no bullets, no extra " +
    "commentary. Each step under 8 words.";

function parseSteps(rawContent: string, taskText: string): string[] {
    const lines = rawContent
        .split("\n")
        .map((line) => line.replace(/^[\s\-*\d.)]+/, "").trim())
        .filter((line) => line.length > 0);

    const steps = lines.slice(0, 3);
    while (steps.length < 3) {
        steps.push(`Work on: ${taskText} (part ${steps.length + 1})`);
    }
    return steps;
}

/**
 * Always resolves with exactly 3 non-empty strings — falls back to a generic
 * 3-way split on network/parse failure so the mission flow never dead-ends.
 * `hostScript` (pass `this` from the calling BaseScriptComponent) only owns
 * the timeout's DelayedCallbackEvent — the request itself isn't tied to it.
 */
export function breakDownTask(taskText: string, hostScript: BaseScriptComponent): Promise<string[]> {
    const request = OpenAI.chatCompletions({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: taskText },
        ],
        temperature: 0.7,
    }).then((response) => {
        const content = response.choices?.[0]?.message?.content ?? "";
        return parseSteps(content, taskText);
    });

    return Promise.race([request, timeoutAfter(hostScript, REQUEST_TIMEOUT_SECONDS)]).catch(() => [
        `Start: ${taskText}`,
        `Continue: ${taskText}`,
        `Finish: ${taskText}`,
    ]);
}
