const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const fs = require("fs");
const db = require("./db");
const cardsStore = require("./cardsStore");
const supabaseListener = require("./supabase-listener");

// start listener to keep cards.json and in-memory cards up to date when the
// Supabase table changes. This runs safely even if SUPABASE_* env vars are not set.
supabaseListener.start();
// Ensure we perform an initial fetch so in-memory state is current on startup
supabaseListener.fetchAndUpdate(true).catch(err => console.error('[supabase-listener] initial fetch failed', err));

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require("discord.js");

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Helper to update an interaction safely. If updating the original
// message fails (Unknown interaction / already acknowledged),
// fall back to posting a fresh message to the channel and notify
// the user ephemeralally.
async function safeUpdate(interactionObj, payload) {
    try {
        // If the interaction has already been deferred or replied, calling
        // update() will fail. Prefer followUp in that case. This avoids
        // "The reply to this interaction has already been sent or deferred." errors.
        if (interactionObj.deferred || interactionObj.replied) {
            try {
                await interactionObj.followUp?.(payload);
                return;
            } catch (followErr) {
                console.warn('[safeUpdate] followUp failed, will try channel send', followErr && followErr.message);
            }
        } else {
            await interactionObj.update(payload);
            return;
        }
    } catch (err) {
        console.error('[safeUpdate] update/followUp failed, falling back to new message', err && err.message);
        try {
            // Try to notify the user briefly (best-effort)
            await interactionObj.reply?.({ content: 'Could not update the previous view; opened a fresh one.', ephemeral: true });
        } catch (e) {
            // ignore notify errors
        }
        try {
            // If possible, try to remove the original (now-stale) message so users don't see two copies
            const oldMsgId = interactionObj.message?.id;
            if (oldMsgId && interactionObj.channel && interactionObj.channel.messages && interactionObj.channel.messages.fetch) {
                try {
                    const old = await interactionObj.channel.messages.fetch(oldMsgId);
                    if (old && old.deletable) await old.delete();
                } catch (delErr) {
                    // best-effort - log and continue
                    console.warn('[safeUpdate] failed to delete original message', delErr && delErr.message);
                }
            }
            // Attempt to send a public message with the requested payload
            if (interactionObj.channel && interactionObj.channel.send) {
                // Ensure components/embeds present in payload are forwarded
                await interactionObj.channel.send(payload);
            }
        } catch (e) {
            console.error('[safeUpdate] fallback send failed', e && e.message);
        }
    }
}

// Attach collector and handlers for an album message (used for /album and /showalbum)
function attachAlbumHandlers(message, ctx) {
    const { album, user, makeEmbed, row, prevButton, nextButton, deleteButton, closeButton, confirmRow } = ctx;
    // state object to allow shared mutation of idx across closures
    const state = ctx.state || { idx: 0 };

    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120000 });

    collector.on('collect', async (i) => {
        try {
            if (i.user.id !== user.id) {
                await i.reply({ content: "These buttons aren't for you.", ephemeral: true });
                return;
            }

            // Acknowledge quickly to avoid "Interaction failed" UI; we'll edit the message instead
            try { await i.deferUpdate(); } catch (e) { /* ignore */ }

            if (i.customId === "album_prev" || i.customId === "sa_prev") {
                state.idx = Math.max(0, state.idx - 1);
                prevButton.setDisabled(state.idx === 0);
                nextButton.setDisabled(state.idx === album.length - 1);
                try {
                    await message.edit({ embeds: [makeEmbed(state.idx)], components: [row] });
                } catch (err) {
                    // fallback: notify and open a fresh message with new collector
                    try { await i.followUp({ content: 'Could not update the view; opened a fresh one.', ephemeral: true }); } catch (e) {}
                        try {
                            // best-effort: remove the stale original message so it doesn't remain visible
                            if (message && message.deletable) await message.delete();
                        } catch (delErr) { /* ignore */ }
                        const newMsg = await message.channel.send({ embeds: [makeEmbed(state.idx)], components: [row] });
                        attachAlbumHandlers(newMsg, Object.assign({}, ctx, { state }));
                    collector.stop('replaced');
                }

            } else if (i.customId === "album_next" || i.customId === "sa_next") {
                state.idx = Math.min(album.length - 1, state.idx + 1);
                prevButton.setDisabled(state.idx === 0);
                nextButton.setDisabled(state.idx === album.length - 1);
                try {
                    await message.edit({ embeds: [makeEmbed(state.idx)], components: [row] });
                } catch (err) {
                    try { await i.followUp({ content: 'Could not update the view; opened a fresh one.', ephemeral: true }); } catch (e) {}
                    try {
                        // best-effort: remove the stale original message so it doesn't remain visible
                        if (message && message.deletable) await message.delete();
                    } catch (delErr) { /* ignore */ }
                    const newMsg = await message.channel.send({ embeds: [makeEmbed(state.idx)], components: [row] });
                    attachAlbumHandlers(newMsg, Object.assign({}, ctx, { state }));
                    collector.stop('replaced');
                }

            } else if (i.customId === "album_delete") {
                try {
                    await message.edit({ content: `Are you sure you want to delete entry ${state.idx + 1}?`, embeds: [], components: [confirmRow] });
                } catch (err) {
                    try { await i.followUp({ content: 'Could not show confirmation inline; opened a fresh view.', ephemeral: true }); } catch (e) {}
                    try {
                        // best-effort: remove the stale original message so it doesn't remain visible
                        if (message && message.deletable) await message.delete();
                    } catch (delErr) { /* ignore */ }
                    const newMsg = await message.channel.send({ content: `Are you sure you want to delete entry ${state.idx + 1}?`, components: [confirmRow] });
                    attachAlbumHandlers(newMsg, Object.assign({}, ctx, { state }));
                    collector.stop('replaced');
                }

            } else if (i.customId === "confirm_delete") {
                const entry = album[state.idx];
                const entryId = entry.entry_id;
                const ok = deleteAlbumEntry(user.id, entryId);
                if (!ok) {
                    try { await i.update({ content: 'Failed to delete the entry.', embeds: [], components: [] }); } catch (err) {
                        try { await i.reply({ content: 'Failed to delete the entry.', ephemeral: true }); } catch (e) {}
                    }
                    collector.stop('deleted');
                    return;
                }
                const deletedIndex = state.idx;
                album.splice(state.idx, 1);
                if (album.length === 0) {
                    try { await i.update({ content: 'Deleted. Your album is now empty.', embeds: [], components: [] }); } catch (err) {
                        try { await i.reply({ content: 'Deleted. Your album is now empty.', ephemeral: true }); } catch (e) {}
                    }
                    collector.stop('deleted');
                    return;
                }
                state.idx = Math.min(deletedIndex, album.length - 1);
                prevButton.setDisabled(state.idx === 0);
                nextButton.setDisabled(state.idx === album.length - 1);
                try {
                    await message.edit({ content: `Deleted entry #${deletedIndex + 1}.`, embeds: [makeEmbed(state.idx)], components: [row] });
                } catch (err) {
                    try { await i.followUp({ content: `Deleted entry #${deletedIndex + 1}.`, ephemeral: true }); } catch (e) {}
                    try {
                        // best-effort: remove the stale original message so it doesn't remain visible
                        if (message && message.deletable) await message.delete();
                    } catch (delErr) { /* ignore */ }
                    const newMsg = await message.channel.send({ content: `Deleted entry #${deletedIndex + 1}.`, embeds: [makeEmbed(state.idx)], components: [row] });
                    attachAlbumHandlers(newMsg, Object.assign({}, ctx, { state }));
                    collector.stop('replaced');
                }

            } else if (i.customId === "cancel_delete") {
                try {
                    await message.edit({ content: null, embeds: [makeEmbed(state.idx)], components: [row] });
                } catch (err) {
                    try { await i.followUp({ content: 'Could not restore the view; opened a fresh one.', ephemeral: true }); } catch (e) {}
                    try {
                        // best-effort: remove the stale original message so it doesn't remain visible
                        if (message && message.deletable) await message.delete();
                    } catch (delErr) { /* ignore */ }
                    const newMsg = await message.channel.send({ embeds: [makeEmbed(state.idx)], components: [row] });
                    attachAlbumHandlers(newMsg, Object.assign({}, ctx, { state }));
                    collector.stop('replaced');
                }

            } else if (i.customId === "album_close" || i.customId === "sa_close") {
                prevButton.setDisabled(true);
                nextButton.setDisabled(true);
                deleteButton?.setDisabled?.(true);
                closeButton.setDisabled(true);
                try {
                    await message.edit({ content: i.customId === 'album_close' ? 'Closed album view.' : 'Closed view.', embeds: [makeEmbed(state.idx)], components: [row] });
                } catch (err) {
                    try { await i.followUp({ content: 'Could not close inline; opened a fresh closed view.', ephemeral: true }); } catch (e) {}
                    try {
                        // best-effort: remove the stale original message so it doesn't remain visible
                        if (message && message.deletable) await message.delete();
                    } catch (delErr) { /* ignore */ }
                    const newMsg = await message.channel.send({ content: 'Closed view.', embeds: [makeEmbed(state.idx)], components: [row] });
                    attachAlbumHandlers(newMsg, Object.assign({}, ctx, { state }));
                    collector.stop('replaced');
                }
                collector.stop('closed');
            }
        } catch (err) {
            console.error('[album] handler error', err);
            try { await i.reply({ content: 'An error occurred.', ephemeral: true }); } catch (e) {}
        }
    });

    collector.on('end', async () => {
        try {
            prevButton.setDisabled(true);
            nextButton.setDisabled(true);
            closeButton.setDisabled(true);
            await message.edit({ components: [row] });
        } catch (err) {
            // ignore
        }
    });

    return collector;
}

// Attach handlers for a pull message (Save / Reroll / Quit)
function attachPullHandlers(message, ctx) {
    const { user, makeEmbed, row, saveButton, rerollButton, quitButton } = ctx;
    // mutable state held here
    const state = ctx.state || { card: ctx.card };

    try { console.log('[attachPullHandlers] attaching pull handlers to message', { messageId: message.id, user: user?.id, cardId: state.card && state.card.id }); } catch (e) {}
    // Allow configuring the pull UI timeout via PULL_COLLECTOR_TIMEOUT_MS in .env
    // If the env var is 0 or unset, we omit the `time` option so the collector does not auto-timeout
    const _pullTimeout = parseInt(process.env.PULL_COLLECTOR_TIMEOUT_MS, 10);
    const collectorOptions = { componentType: ComponentType.Button };
    if (!Number.isNaN(_pullTimeout) && _pullTimeout > 0) collectorOptions.time = _pullTimeout;
    try { console.log('[attachPullHandlers] creating collector with options', collectorOptions); } catch (e) {}
    const collector = message.createMessageComponentCollector(collectorOptions);
    try { console.log('[attachPullHandlers] collector created for message', { messageId: message.id, collector: !!collector }); } catch (e) {}

    collector.on('collect', async (i) => {
        try {
            if (i.user.id !== user.id) {
                await i.reply({ content: "These buttons aren't for you.", ephemeral: true });
                return;
            }

            // acknowledge quickly to avoid 'Interaction failed' UI
            try { await i.deferUpdate(); } catch (e) { /* ignore */ }

            // Debug: log component press and interaction state
            try { console.log('[pull][handler] button pressed', { customId: i.customId, user: i.user.id, replied: i.replied, deferred: i.deferred }); } catch (e) {}

            if (i.customId === 'save') {
                const added = saveCardToAlbum(user.id, state.card);
                saveButton.setDisabled(true);
                if (!added) {
                    try {
                        await message.edit({ content: "you already have this in your album", embeds: [makeEmbed()], components: [row] });
                    } catch (err) {
                        try { await i.followUp({ content: 'Could not update the previous view; opened a fresh one.', ephemeral: true }); } catch (e) {}
                        try { if (message && message.deletable) await message.delete(); } catch (e) {}
                        const newMsg = await message.channel.send({ content: "you already have this in your album", embeds: [makeEmbed()], components: [row] });
                        attachPullHandlers(newMsg, Object.assign({}, ctx, { state }));
                        collector.stop('replaced');
                    }
                    collector.stop('saved');
                    return;
                }
                rerollButton.setDisabled(true);
                quitButton.setDisabled(true);
                try {
                    await message.edit({ content: 'Saved to your album.', embeds: [makeEmbed()], components: [row] });
                } catch (err) {
                    try { await i.followUp({ content: 'Saved to your album.', ephemeral: true }); } catch (e) {}
                    try { if (message && message.deletable) await message.delete(); } catch (e) {}
                    const newMsg = await message.channel.send({ content: 'Saved to your album.', embeds: [makeEmbed()], components: [row] });
                    attachPullHandlers(newMsg, Object.assign({}, ctx, { state }));
                    collector.stop('replaced');
                }
                collector.stop('saved');

            } else if (i.customId === 'reroll') {
                // roll again and update embed
                state.card = rollCard();
                // Debug: log newly selected card on reroll
                try { console.log('[pull][reroll] new card', String(state.card && state.card.id), 'rarity', String(state.card && state.card.rarity)); } catch (e) {}
                try {
                    await message.edit({ content: null, embeds: [makeEmbed()], components: [row] });
                } catch (err) {
                    try { await i.followUp({ content: 'Could not update the view; opened a fresh one.', ephemeral: true }); } catch (e) {}
                    try { if (message && message.deletable) await message.delete(); } catch (e) {}
                    const newMsg = await message.channel.send({ embeds: [makeEmbed()], components: [row] });
                    attachPullHandlers(newMsg, Object.assign({}, ctx, { state }));
                    collector.stop('replaced');
                }

            } else if (i.customId === 'quit') {
                saveButton.setDisabled(true);
                rerollButton.setDisabled(true);
                quitButton.setDisabled(true);
                try {
                    await message.edit({ content: 'Pull canceled.', embeds: [makeEmbed()], components: [row] });
                } catch (err) {
                    try { await i.followUp({ content: 'Pull canceled.', ephemeral: true }); } catch (e) {}
                    try { if (message && message.deletable) await message.delete(); } catch (e) {}
                    const newMsg = await message.channel.send({ content: 'Pull canceled.', embeds: [makeEmbed()], components: [row] });
                    attachPullHandlers(newMsg, Object.assign({}, ctx, { state }));
                    collector.stop('replaced');
                }
                collector.stop('quit');
            }
        } catch (err) {
            console.error('[pull] handler error', err);
            try { await i.followUp({ content: 'An error occurred.', ephemeral: true }); } catch (e) {}
        }
    });

    collector.on('end', async () => {
        try {
            saveButton.setDisabled(true);
            rerollButton.setDisabled(true);
            quitButton.setDisabled(true);
            await message.edit({ components: [row] });
        } catch (err) {
            // ignore
        }
    });

    return collector;
}

// Function to roll a random card based on rarity probabilities
function rollCard() {
    // Rarity probabilities (cumulative thresholds). Lower values make pulls harder.
    // Tweak these numbers to change the drop rates. They must be in increasing order and
    // the final else bucket is the common rarity.
    // Current targets (example):
    // I   - 0.5%  (very rare)
    // UR  - 2.0%  (ultra rare)
    // SR  - 5.0%  (super rare)
    // R   - 12.0% (rare)
    // UC  - 20.0% (uncommon)
    // C   - remaining (~60.5%)
    const r = Math.random();
    let rarity;
    if (r < 0.005) rarity = "I";            // 0.5%
    else if (r < 0.025) rarity = "UR";      // 2.0% (0.025 - cumulative)
    else if (r < 0.075) rarity = "SR";      // 5.0%
    else if (r < 0.195) rarity = "R";       // 12.0%
    else if (r < 0.395) rarity = "UC";      // 20.0%
    else rarity = "C";                      // ~60.5%

    const pool = cardsStore.getCards().filter((c) => {
        const r = c && c.rarity ? String(c.rarity).toUpperCase().trim() : '';
        // match if the stored rarity starts with the target code (e.g., 'COMMON' -> 'C')
        return r && r.startsWith(String(rarity).toUpperCase());
    });

    // Fallback: if no card matches the chosen rarity, return a random card
        if (!pool || pool.length === 0) {
        // If the cards list is empty, return a placeholder object so callers
        // can safely render a message instead of throwing.
        const current = cardsStore.getCards();
        if (!current || current.length === 0) {
            return { id: "none", name: "No cards available", group: null, file: null, rarity: "?" };
        }
        return current[Math.floor(Math.random() * current.length)];
    }

    return pool[Math.floor(Math.random() * pool.length)];

}

// Export for testing/other modules
module.exports = { rollCard, saveCardToAlbum, getUserAlbum, deleteAlbumEntry, findCardById, sendBugReport };



// Save pulled card to user's album
function saveCardToAlbum(userId, card) {
    // Defensive handling: card may be an object, a string ID, or null/undefined
    if (!card) {
        console.warn(`[saveCardToAlbum] invalid card value for user=${userId}`);
        return false;
    }
    let cardId;
    if (typeof card === 'string') cardId = card.trim();
    else cardId = card.id ? String(card.id).trim() : '';
    if (!cardId) {
        console.warn(`[saveCardToAlbum] could not determine cardId for user=${userId}`);
        return false;
    }

    // Prevent duplicate entries for the same user and card
    const existsStmt = db.prepare(`SELECT 1 FROM pulls WHERE user_id = ? AND card_id = ? LIMIT 1`);
    const found = existsStmt.get(userId, cardId);
        if (found) {
                console.log(`[saveCardToAlbum] duplicate prevented for user=${userId} card=${cardId}`);
                return false;
        }

            const stmt = db.prepare(`
            INSERT INTO pulls (user_id, card_id, pulled_at)
            VALUES (?, ?, ?)
        `);
            try {
                    stmt.run(userId, cardId, Date.now());
                    console.log(`[saveCardToAlbum] saved user=${userId} card=${cardId}`);
                    return true;
            } catch (err) {
                    // If a UNIQUE constraint is violated (race or duplicate), treat as duplicate
                    console.warn(`[saveCardToAlbum] insert failed, likely duplicate for user=${userId} card=${cardId}:`, err.message);
                    return false;
            }
}

// Get all cards in user's album
function getUserAlbum(userId) {
        const stmt = db.prepare(`
        SELECT p.id AS entry_id, p.card_id, p.pulled_at
        FROM pulls p
        WHERE p.user_id = ?
        ORDER BY p.pulled_at DESC
    `);
        return stmt.all(userId);
}

// Delete a card from user's album
function deleteAlbumEntry(userId, entryID) {
        const stmt = db.prepare(`
        DELETE FROM pulls
        WHERE user_id = ? AND id = ?
    `);
        const info = stmt.run(userId, entryID);
    return info.changes > 0;
}

// Find card by ID
function findCardById(cardId) {
    const list = cardsStore.getCards() || [];
    if (cardId == null) return null;
    // Normalize IDs for tolerant matching (trim + case-insensitive)
    const target = String(cardId).trim().toLowerCase();
    return list.find(c => {
        try {
            return String(c.id || '').trim().toLowerCase() === target;
        } catch (e) {
            return false;
        }
    }) || null;
}

// Centralized admin check helper. Logs unauthorized attempts for diagnostics.
function isAdmin(interaction) {
    const envList = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (process.env.OWNER_ID) envList.push(String(process.env.OWNER_ID).trim());
    const adminIds = Array.from(new Set(envList.map(String)));
    const uid = interaction.user?.id ? String(interaction.user.id) : '';
    const ok = adminIds.includes(uid);
    if (!ok) console.log('[auth] unauthorized admin attempt', { user: uid, command: interaction.commandName, adminIds: adminIds.join(',') });
    return ok;
}

// Helper to handle bug reporting. Separated for testing.
async function sendBugReport(clientParam, interaction) {
    // Defer quickly so the interaction doesn't time out while we fetch/send
    try {
        if (!interaction.deferred && !interaction.replied && typeof interaction.deferReply === 'function') {
            await interaction.deferReply({ ephemeral: true });
        }
    } catch (e) {
        // ignore defer errors, we'll still try to reply later
    }

    const description = interaction.options.getString("description", true)?.trim();
    const imageUrl = interaction.options.getString("image_url", false);

    const bugChannelId = process.env.BUG_CHANNEL_ID;
    console.log('[bug] sendBugReport invoked by', interaction.user?.id, 'BUG_CHANNEL_ID=', bugChannelId);

    try { console.log('[bug] after defer, replied=', interaction.replied, 'deferred=', interaction.deferred); } catch (e) {}
    if (!bugChannelId) {
        try { if (typeof interaction.editReply === 'function') await interaction.editReply({ content: 'Bug reporting is not configured on this bot (BUG_CHANNEL_ID missing).' }); else await interaction.reply({ content: 'Bug reporting is not configured on this bot (BUG_CHANNEL_ID missing).', ephemeral: true }); } catch (e) { /* ignore */ }
        return { ok: false, reason: 'BUG_CHANNEL_ID missing' };
    }

    try {
        console.log('[bug] fetching channel', bugChannelId);
        const bugChannel = await clientParam.channels.fetch(bugChannelId);
        console.log('[bug] fetched channel', !!bugChannel);
        if (!bugChannel || !bugChannel.send) {
            try { if (typeof interaction.editReply === 'function') await interaction.editReply({ content: 'Could not find bug channel. Please check BUG_CHANNEL_ID.' }); else await interaction.reply({ content: 'Could not find bug channel. Please check BUG_CHANNEL_ID.', ephemeral: true }); } catch (e) { /* ignore */ }
            return { ok: false, reason: 'channel-not-found' };
        }

        const embed = new EmbedBuilder()
            .setTitle('New Bug Report')
            .setDescription(description || '(no description)')
            .addFields({ name: 'Reporter', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: false })
            .setTimestamp();

        if (imageUrl) {
            try { embed.setImage(imageUrl); } catch (e) { /* ignore invalid url */ }
        }

        const sent = await bugChannel.send({ embeds: [embed] });
        console.log('[bug] sent report message id=', sent && sent.id);
        try { if (typeof interaction.editReply === 'function') await interaction.editReply({ content: 'Thanks — your bug report was sent to the team.' }); else await interaction.reply({ content: 'Thanks — your bug report was sent to the team.', ephemeral: true }); } catch (e) { /* ignore */ }
        return { ok: true };
    } catch (err) {
        console.error('[bug] failed to post report', err);
        try { if (typeof interaction.editReply === 'function') await interaction.editReply({ content: 'Failed to send bug report. Please contact a maintainer directly.' }); else await interaction.reply({ content: 'Failed to send bug report. Please contact a maintainer directly.', ephemeral: true }); } catch (e) { /* ignore */ }
        return { ok: false, reason: 'send-failed', error: err };
    }
}

// Interaction flow for /pull: present card with Save / Reroll / Quit buttons
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, user } = interaction;

    // Top-level guard to catch unexpected errors and ensure we acknowledge the interaction
    try {

    if (commandName === "pull") {
        let card = rollCard();
        // Debug: log which card was selected for a pull
        try { console.log('[debug][pull] selected card', String(card && card.id), 'rarity', String(card && card.rarity)); } catch (e) {}

        // Use a shared mutable state so attachPullHandlers can update the
        // current card (state.card) and makeEmbed will always read the
        // latest value. This avoids stale closures where reroll changes
        // state.card but the embed function still reads an outer variable.
        const state = { card };
        const makeEmbed = () => new EmbedBuilder()
            .setTitle(state.card.name || "Unknown Card")
            .setDescription(state.card.group ? state.card.group : null)
            .setImage(state.card.file || state.card.image_url || state.card.image || undefined)
            .setFooter({ text: `Rarity: ${state.card.rarity || "?"} • ID: ${state.card.id}` });

        const saveButton = new ButtonBuilder()
            .setCustomId("save")
            .setLabel("Save")
            .setStyle(ButtonStyle.Primary);

        const rerollButton = new ButtonBuilder()
            .setCustomId("reroll")
            .setLabel("Reroll")
            .setStyle(ButtonStyle.Secondary);

        const quitButton = new ButtonBuilder()
            .setCustomId("quit")
            .setLabel("Quit")
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(saveButton, rerollButton, quitButton);

    // Try to defer and edit the original interaction so Discord marks it
    // acknowledged quickly. If that fails (for example the interaction
    // token is no longer valid / Unknown interaction), fall back to posting
    // a fresh channel message and attach the same component handlers.
    try {
        await interaction.deferReply({ ephemeral: false });
        await interaction.editReply({ embeds: [makeEmbed()], components: [row] });
        const message = await interaction.fetchReply();
        // Attach the shared pull handlers which already handle defer/update
        attachPullHandlers(message, { user: interaction.user, makeEmbed, row, saveButton, rerollButton, quitButton, card: state.card, state });
        return;
    } catch (err) {
        console.warn('[pull] could not defer/edit reply, falling back to channel send', err && err.message);
        try {
            // Best-effort public message when the original interaction cannot be used
            const message = await (interaction.channel && interaction.channel.send ? interaction.channel.send({ embeds: [makeEmbed()], components: [row] }) : (typeof interaction.reply === 'function' ? interaction.reply({ embeds: [makeEmbed()], components: [row], ephemeral: false }) : null));
            // If interaction.reply() returned a Promise that resolves to a message, fetch it
            const resolvedMsg = message && message.then ? await message : message;
            if (resolvedMsg && resolvedMsg.createMessageComponentCollector) {
                attachPullHandlers(resolvedMsg, { user: interaction.user, makeEmbed, row, saveButton, rerollButton, quitButton, card: state.card, state });
                return;
            }
        } catch (sendErr) {
            console.error('[pull] fallback send failed', sendErr && sendErr.message);
        }
        // If all else fails, try to inform the user ephemerally
        try { if (!interaction.replied) await interaction.reply({ content: 'Could not open pull view. Please try again.', ephemeral: true }); } catch (e) { /* ignore */ }
        return;
    }
    }

    // Admin-only debug command to show a specific card by ID
    if (commandName === "debug-show") {
        const id = interaction.options.getString("id", true);
        if (!isAdmin(interaction)) {
            await interaction.reply({ content: 'Not authorized to use this command.', ephemeral: true });
            return;
        }

        const card = findCardById(id);
        if (!card) {
            await interaction.reply({ content: `Card with id ${id} not found.`, ephemeral: true });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(card.name || 'Unknown Card')
            .setDescription(card.group ? card.group : null)
            .setImage(card.file || card.image_url || card.image || undefined)
            .setFooter({ text: `Rarity: ${card.rarity || '?'} • ID: ${card.id}` });

        // Public reply so you can confirm UI; it's admin-only so should be safe
        await interaction.reply({ embeds: [embed], ephemeral: false });
        return;
    }

    // Admin-only: force display a card with full pull handlers (Save/Reroll/Quit)
    if (commandName === "force-pull") {
        const id = interaction.options.getString("id", true);
        if (!isAdmin(interaction)) {
            await interaction.reply({ content: 'Not authorized to use this command.', ephemeral: true });
            return;
        }

        const card = findCardById(id);
        if (!card) {
            await interaction.reply({ content: `Card with id ${id} not found.`, ephemeral: true });
            return;
        }

        // Build embed and buttons similar to /pull
        const makeEmbed = () => new EmbedBuilder()
            .setTitle(card.name || "Unknown Card")
            .setDescription(card.group ? card.group : null)
            .setImage(card.file || card.image_url || card.image || undefined)
            .setFooter({ text: `Rarity: ${card.rarity || "?"} • ID: ${card.id}` });

        const saveButton = new ButtonBuilder().setCustomId("save").setLabel("Save").setStyle(ButtonStyle.Primary);
        const rerollButton = new ButtonBuilder().setCustomId("reroll").setLabel("Reroll").setStyle(ButtonStyle.Secondary);
        const quitButton = new ButtonBuilder().setCustomId("quit").setLabel("Quit").setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(saveButton, rerollButton, quitButton);

        await interaction.reply({ embeds: [makeEmbed()], components: [row] });
        const message = await interaction.fetchReply();
        // Attach pull handlers with initial card state
        attachPullHandlers(message, { user: interaction.user, makeEmbed, row, saveButton, rerollButton, quitButton, card, state: { card } });
        return;
    }

    // Public bug report command: posts a bug embed to BUG_CHANNEL_ID
    if (commandName === "bug") {
        // Delegate to testable helper
        await sendBugReport(client, interaction);
        return;
    }

    // Admin-only: refresh the in-memory cards from Supabase and save to cards.json
    if (commandName === "refresh-cards") {
        // Build admin allowlist from env: ADMIN_IDS (comma-separated) and OWNER_ID
        if (!isAdmin(interaction)) {
            await interaction.reply({ content: 'Not authorized to use this command.', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        try {
            const before = (cardsStore.getCards() || []).length;
            await supabaseListener.fetchAndUpdate(true);
            const after = (cardsStore.getCards() || []).length;
            await interaction.editReply({ content: `Refreshed cards from Supabase. Before: ${before}, After: ${after}.` });
        } catch (err) {
            console.error('[refresh-cards] failed', err);
            try { await interaction.editReply({ content: 'Failed to refresh cards: ' + String(err.message || err) }); } catch (e) {}
        }
        return;
    }

    // Admin-only: normalize/troubleshoot album DB card_ids and report missing IDs
    if (commandName === "repair-album") {
        if (!isAdmin(interaction)) {
            await interaction.reply({ content: 'Not authorized to use this command.', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        try {
            // Create a backup is handled by db.js migrations when required
            // Trim card_id values
            db.prepare(`UPDATE pulls SET card_id = TRIM(card_id) WHERE card_id IS NOT NULL`).run();

            const rows = db.prepare('SELECT COUNT(*) AS c FROM pulls').get().c;
            const distinct = db.prepare('SELECT DISTINCT card_id FROM pulls').all().map(r => String(r.card_id || '').trim()).filter(Boolean);
            const cards = cardsStore.getCards() || [];
            const cardIds = new Set(cards.map(c => String(c.id || '').trim().toLowerCase()));
            const missing = distinct.filter(id => !cardIds.has(String(id).trim().toLowerCase()));

            await interaction.editReply({ content: `Album normalized. Total pulls: ${rows}. Distinct card_ids: ${distinct.length}. Missing IDs: ${missing.length}${missing.length>0 ? '\nSample missing: ' + missing.slice(0,20).join(', ') : ''}` });
        } catch (err) {
            console.error('[repair-album] failed', err);
            try { await interaction.editReply({ content: 'Failed to repair album: ' + String(err.message || err) }); } catch (e) {}
        }
        return;
    }


    if (commandName === "album") {
        const album = getUserAlbum(user.id) || [];
        if (album.length === 0) {
            await interaction.reply({ content: "Your album is empty. Pull some cards first!", ephemeral: true });
            return;
        }

        console.log(`[album] invoked by ${user.tag} (${user.id}) — ${album.length} entries`);

        // Paginated viewer: shows one card per page with Prev/Next/Close buttons
        let idx = 0;

        const makeEmbed = (index) => {
            const entry = album[index];
            const card = findCardById(entry.card_id) || { name: null, group: "", file: null, rarity: "?" };
            // Debug: log which card object is used to render an album entry
            try { console.log('[debug][album] render entry', entry.card_id, '->', String(card.id), 'rarity', String(card.rarity)); } catch (e) {}
            const title = card.name || `Unknown Card (id: ${String(entry.card_id || '')})`;
            const footerRarity = card.rarity || "?";
            return new EmbedBuilder()
                .setTitle(title)
                .setDescription(card.group ? card.group : null)
                .setImage(card.file || card.image_url || card.image || undefined)
                .setFooter({ text: `Entry ${index + 1}/${album.length} • Rarity: ${footerRarity}` });
        };

    const prevButton = new ButtonBuilder().setCustomId("album_prev").setLabel("◀ Prev").setStyle(ButtonStyle.Secondary);
    const nextButton = new ButtonBuilder().setCustomId("album_next").setLabel("Next ▶").setStyle(ButtonStyle.Secondary);
    const deleteButton = new ButtonBuilder().setCustomId("album_delete").setLabel("Delete").setStyle(ButtonStyle.Danger);
    const closeButton = new ButtonBuilder().setCustomId("album_close").setLabel("Close").setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(prevButton, nextButton, deleteButton, closeButton);

    // confirmation row (shown when user clicks Delete)
    const confirmYes = new ButtonBuilder().setCustomId("confirm_delete").setLabel("Yes, delete").setStyle(ButtonStyle.Danger);
    const confirmNo = new ButtonBuilder().setCustomId("cancel_delete").setLabel("Cancel").setStyle(ButtonStyle.Secondary);
    const confirmRow = new ActionRowBuilder().addComponents(confirmYes, confirmNo);

        // initial state
        prevButton.setDisabled(idx === 0);
        nextButton.setDisabled(idx === album.length - 1);

    // Make album reply non-ephemeral so we can fetch the message and attach a collector
    try {
        // Defer the reply to ensure the interaction is acknowledged quickly,
        // then edit the reply with the embed and components. This avoids timing
        // races that can cause "Interaction has already been acknowledged" errors.
        await interaction.deferReply({ ephemeral: false });
        await interaction.editReply({ embeds: [makeEmbed(idx)], components: [row] });
    } catch (err) {
        console.error('[album] reply/edit failed', {
            id: interaction.id,
            type: interaction.type,
            commandName: interaction.commandName,
            user: interaction.user?.id,
            createdTimestamp: interaction.createdTimestamp,
            replied: interaction.replied,
            deferred: interaction.deferred,
            error: err
        });
        throw err;
    }
    const message = await interaction.fetchReply();

        // attach handlers (wrapped in helper) so fallbacks create a fresh message with a working collector
        attachAlbumHandlers(message, { album, user, makeEmbed, row, prevButton, nextButton, deleteButton, closeButton, confirmRow, state: { idx } });
        return;
        return;
    }

    if (commandName === "showalbum") {
        // View another user's album (or your own if not specified)
        const targetUser = interaction.options.getUser("user") || user;
        const album = getUserAlbum(targetUser.id) || [];

        if (album.length === 0) {
            await interaction.reply({ content: `${targetUser.username} has an empty album.`, ephemeral: true });
            return;
        }

        let idx = 0;

        const makeEmbedFor = (index) => {
            const entry = album[index];
            const card = findCardById(entry.card_id) || { name: null, group: "", file: null, rarity: "?" };
            const title = card.name || `Unknown Card (id: ${String(entry.card_id || '')})`;
            return new EmbedBuilder()
                .setTitle(title)
                .setDescription(card.group ? card.group : null)
                .setImage(card.file || card.image_url || card.image || undefined)
                .setFooter({ text: `${targetUser.username} • Entry ${index + 1}/${album.length} • Rarity: ${card.rarity || "?"}` });
        };

        const prevButton = new ButtonBuilder().setCustomId("sa_prev").setLabel("◀ Prev").setStyle(ButtonStyle.Secondary);
        const nextButton = new ButtonBuilder().setCustomId("sa_next").setLabel("Next ▶").setStyle(ButtonStyle.Secondary);
        const closeButton = new ButtonBuilder().setCustomId("sa_close").setLabel("Close").setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(prevButton, nextButton, closeButton);

        prevButton.setDisabled(idx === 0);
        nextButton.setDisabled(idx === album.length - 1);

        // Defer and then edit to avoid races
        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({ embeds: [makeEmbedFor(idx)], components: [row] });
        const message = await interaction.fetchReply();

        attachAlbumHandlers(message, { album, user, makeEmbed: makeEmbedFor, row, prevButton, nextButton, deleteButton: null, closeButton, confirmRow: null, state: { idx } });
        return;
    }

    if (commandName === "show") {
        const number = interaction.options.getInteger("number", true);
        const album = getUserAlbum(user.id) || [];
        const idx = number - 1;
        if (idx < 0 || idx >= album.length) {
            await interaction.reply({ content: "Invalid album number.", ephemeral: true });
            return;
        }
        const entry = album[idx];
        const card = findCardById(entry.card_id);
            if (!card) {
            await interaction.reply({ content: "Card not found.", ephemeral: true });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(card.name || "Unknown Card")
            .setDescription(card.group ? card.group : null)
            .setImage(card.file || card.image_url || card.image || undefined)
            .setFooter({ text: `Rarity: ${card.rarity || "?"} • ID: ${card.id}` });

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

        if (commandName === "delete") {
            const number = interaction.options.getInteger("number", true);
            const album = getUserAlbum(user.id) || [];
            const idx = number - 1;
            if (idx < 0 || idx >= album.length) {
                await interaction.reply({ content: "Invalid album number.", ephemeral: true });
                return;
            }
        const entry = album[idx];
        const ok = deleteAlbumEntry(user.id, entry.entry_id);
            if (!ok) {
                await interaction.reply({ content: "Failed to delete the entry.", ephemeral: true });
            } else {
                await interaction.reply({ content: `Deleted album entry #${number}.`, ephemeral: true });
            }
            return;
        }
    } catch (err) {
        console.error('[interaction handler] unexpected error', err);
        try {
            if (interaction && typeof interaction.reply === 'function' && !interaction.replied) {
                await interaction.reply({ content: 'An internal error occurred while handling your command.', ephemeral: true });
            }
        } catch (e) {
            // ignore reply failures
        }
    }
});

// Only log in when this file is executed directly (prevents auto-login when required)
// Use module.parent check which is reliable when the file is required vs executed
if (!module.parent) {
    // Use the clientReady event (discord.js v15+ uses clientReady)
    client.once("clientReady", () => {
        console.log(`Logged in as ${client.user.tag}`);
    });

    // Basic error handlers to keep the process from crashing on unhandled errors
    client.on('error', (err) => console.error('[discord client] error', err));
    process.on('unhandledRejection', (reason, p) => console.error('[unhandledRejection]', reason, p));

    client.login(process.env.DISCORD_TOKEN).catch(err => {
        console.error('[discord] failed to login:', err);
        process.exit(1);
    });
}
