require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
    new SlashCommandBuilder()
        .setName("pull")
        .setDescription("Pull a random photo card!!!!"),
    new SlashCommandBuilder()
        .setName("album")
        .setDescription("View your album of collected photo cards"),
    new SlashCommandBuilder()
        .setName("show")
        .setDescription("Show off a card of your choice from your album (by number)")
        .addIntegerOption(opt =>
            opt.setName("number")
                .setDescription("Card number from your album list")
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName("showalbum")
        .setDescription("View another user's album (paginated)")
        .addUserOption(opt =>
            opt.setName("user")
                .setDescription("User whose album you'd like to view")
                .setRequired(false)
        ),
    new SlashCommandBuilder()
        .setName("delete")
        .setDescription("Delete a card from your album by number")
        .addIntegerOption(opt =>
            opt.setName("number")
                .setDescription("Album entry number to delete (from /album list)")
                .setRequired(true)
        )
    ,
    // Admin-only debug command to show a specific card by ID
    new SlashCommandBuilder()
        .setName("debug-show")
        .setDescription("DEBUG: show a card by ID (admin only)")
        .addStringOption(opt =>
            opt.setName("id")
                .setDescription("Card ID to display")
                .setRequired(true)
        )
    ,
    new SlashCommandBuilder()
        .setName("force-pull")
        .setDescription("ADMIN: force-pull a specific card ID (admin only)")
        .addStringOption(opt =>
            opt.setName("id")
                .setDescription("Card ID to force-pull")
                .setRequired(true)
        )
    ,
    new SlashCommandBuilder()
        .setName("bug")
        .setDescription("Report a bug to the maintainers")
        .addStringOption(opt =>
            opt.setName("description")
                .setDescription("Describe the bug you encountered")
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName("image_url")
                .setDescription("Optional image URL or screenshot")
                .setRequired(false)
        )
    ,
    new SlashCommandBuilder()
        .setName("refresh-cards")
        .setDescription("ADMIN: Refresh cards from Supabase and reload into the bot (admin only)")
    ,
    new SlashCommandBuilder()
        .setName("repair-album")
        .setDescription("ADMIN: Normalize album DB card_ids and report any missing card IDs (admin only)")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        {body: commands}

    );
    console.log("Slash Commands Deployed.");

})();




