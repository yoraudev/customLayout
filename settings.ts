/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { isValidLayout, LayoutNode, makeDefaultLayout } from "./tree";

export interface Profile {
    id: string;
    name: string;
    root: LayoutNode;
}

export const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Apply the custom layout while a server is open",
        default: true
    },
    editKeybind: {
        type: OptionType.STRING,
        description: "Keybind that toggles the layout editor, for example ctrl+shift+l. Leave empty to disable",
        default: "ctrl+shift+l"
    },
    profiles: {
        type: OptionType.CUSTOM,
        default: [] as Profile[]
    },
    activeProfile: {
        type: OptionType.CUSTOM,
        default: "" as string
    },
    // server id -> profile id, for servers that use a different profile than the active one
    guildProfiles: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>
    }
});

const FALLBACK_PROFILE: Profile = { id: "default", name: "Default", root: makeDefaultLayout() };

const isValidProfile = (profile: any): profile is Profile =>
    typeof profile?.id === "string" && typeof profile.name === "string" && isValidLayout(profile.root);

export function getProfiles(): Profile[] {
    // The store hands out proxies. Layouts built from those would end up back in the settings, which then fail to save
    const { profiles } = settings.plain;
    const valid = Array.isArray(profiles) ? profiles.filter(isValidProfile) : [];

    return valid.length ? valid : [FALLBACK_PROFILE];
}

export function getProfileFor(guildId: string | null | undefined): Profile {
    const profiles = getProfiles();
    const { activeProfile, guildProfiles } = settings.store;
    const assigned = guildId != null ? guildProfiles?.[guildId] : undefined;

    return profiles.find(p => p.id === assigned)
        ?? profiles.find(p => p.id === activeProfile)
        ?? profiles[0];
}

export const isAssignedTo = (guildId: string, profileId: string) => settings.store.guildProfiles?.[guildId] === profileId;

export function setProfileRoot(profileId: string, root: LayoutNode) {
    settings.store.profiles = getProfiles().map(p => p.id === profileId ? { ...p, root } : p);
}

export function renameProfile(profileId: string, name: string) {
    settings.store.profiles = getProfiles().map(p => p.id === profileId ? { ...p, name } : p);
}

function uniqueName(base: string) {
    const names = new Set(getProfiles().map(p => p.name));
    if (!names.has(base)) return base;

    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
}

/** Creates a profile, optionally as a copy of another one, and returns it */
export function createProfile(source?: Profile): Profile {
    const profile: Profile = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: uniqueName(source ? `${source.name} copy` : "New layout"),
        root: source ? JSON.parse(JSON.stringify(source.root)) : makeDefaultLayout()
    };

    settings.store.profiles = [...getProfiles(), profile];
    return profile;
}

export function deleteProfile(profileId: string) {
    const remaining = getProfiles().filter(p => p.id !== profileId);
    if (!remaining.length) return;

    settings.store.profiles = remaining;
    settings.store.guildProfiles = Object.fromEntries(
        Object.entries(settings.store.guildProfiles ?? {}).filter(([, id]) => id !== profileId)
    );
    if (settings.store.activeProfile === profileId) settings.store.activeProfile = remaining[0].id;
}

/** Selects a profile for the given server if that server has its own profile, otherwise for everything */
export function selectProfile(profileId: string, guildId: string | null | undefined) {
    if (guildId != null && settings.store.guildProfiles?.[guildId] != null)
        settings.store.guildProfiles = { ...settings.store.guildProfiles, [guildId]: profileId };
    else
        settings.store.activeProfile = profileId;
}

export function setGuildAssignment(guildId: string, profileId: string | null) {
    const { [guildId]: _, ...rest } = settings.store.guildProfiles ?? {};
    settings.store.guildProfiles = profileId == null ? rest : { ...rest, [guildId]: profileId };
}

export function matchesKeybind(e: KeyboardEvent) {
    const keys = settings.store.editKeybind.toLowerCase().split("+").map(k => k.trim()).filter(Boolean);
    const key = keys.pop();
    if (!key) return false;

    return e.key.toLowerCase() === key
        && e.ctrlKey === keys.includes("ctrl")
        && e.shiftKey === keys.includes("shift")
        && e.altKey === keys.includes("alt")
        && e.metaKey === keys.includes("meta");
}
